const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

function owner(request) {
  return request.headers.get("x-client-id") || "anonymous";
}

function taskUrl(template, id) { return template.replace("{task_id}", encodeURIComponent(id)); }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": url.origin, "access-control-allow-headers": "content-type,x-client-id,authorization", "access-control-allow-methods": "GET,POST,OPTIONS" } });
    try {
      if (!env.APP_PASSWORD || request.headers.get("authorization") !== `Bearer ${env.APP_PASSWORD}`) return json({ error: "请先输入应用访问密码" }, 401);
      if (url.pathname === "/api/submit" && request.method === "POST") {
        if (!env.DASHSCOPE_API_KEY) return json({ error: "尚未配置 DASHSCOPE_API_KEY Worker Secret" }, 503);
        const body = await request.json();
        if (!Array.isArray(body.scenes) || body.scenes.length > 5) return json({ error: "每批最多提交 5 个分镜" }, 400);
        const created = [];
        for (let i = 0; i < body.scenes.length; i++) {
          const s = body.scenes[i];
          if (!s.image || !s.prompt) continue;
          const prompt = [s.prompt, s.dialogue].filter(Boolean).join("；对白/旁白：");
          const response = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis", {
            method: "POST",
            headers: { "Authorization": `Bearer ${env.DASHSCOPE_API_KEY}`, "X-DashScope-Async": "enable", "Content-Type": "application/json" },
            body: JSON.stringify({ model: body.model || "wan3.0-video-prime", input: { prompt, media: [{ type: "first_frame", url: s.image }] }, parameters: { resolution: "480P", ratio: s.ratio || "16:9", duration: Number(s.duration || 5), audio: Boolean(s.audio), prompt_extend: true } })
          });
          const result = await response.json();
          const remoteId = result?.output?.task_id || result?.task_id;
          if (!response.ok || !remoteId) { created.push({ scene: i + 1, error: result }); continue; }
          const id = crypto.randomUUID(), now = new Date().toISOString();
          await env.DB.prepare("INSERT INTO tasks (id,owner,scene_number,prompt,model,dashscope_task_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
            .bind(id, owner(request), i + 1, prompt, body.model || "wan3.0-video-prime", String(remoteId), "RUNNING", now, now).run();
          created.push({ id, scene: i + 1, status: "RUNNING" });
        }
        return json({ tasks: created });
      }
      if (url.pathname === "/api/tasks" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT id,scene_number,prompt,status,video_key,error,created_at FROM tasks WHERE owner=? ORDER BY created_at DESC LIMIT 50").bind(owner(request)).all();
        return json({ tasks: results });
      }
      const match = url.pathname.match(/^\/api\/tasks\/([\w-]+)$/);
      if (match && request.method === "POST") {
        const task = await env.DB.prepare("SELECT * FROM tasks WHERE id=? AND owner=?").bind(match[1], owner(request)).first();
        if (!task) return json({ error: "任务不存在" }, 404);
        const remote = await fetch(taskUrl("https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}", task.dashscope_task_id), { headers: { "Authorization": `Bearer ${env.DASHSCOPE_API_KEY}` } });
        const result = await remote.json(), output = result?.output || {}, state = output.task_status || result.task_status || task.status;
        let videoKey = task.video_key;
        if (state === "SUCCEEDED" && !videoKey && output.video_url) {
          const videoResponse = await fetch(output.video_url, { headers: { "Authorization": `Bearer ${env.DASHSCOPE_API_KEY}` } });
          if (videoResponse.ok) {
            videoKey = `${task.owner}/${task.id}.mp4`;
            await env.VIDEOS.put(videoKey, videoResponse.body, { httpMetadata: { contentType: "video/mp4" } });
          }
        }
        const error = state === "FAILED" ? (output.message || output.code || "生成失败") : null;
        await env.DB.prepare("UPDATE tasks SET status=?,video_key=?,error=?,updated_at=? WHERE id=?").bind(state, videoKey, error, new Date().toISOString(), task.id).run();
        return json({ id: task.id, status: state, videoUrl: videoKey ? `/api/videos/${encodeURIComponent(task.id)}` : null, error });
      }
      const videoMatch = url.pathname.match(/^\/api\/videos\/([\w-]+)$/);
      if (videoMatch && request.method === "GET") {
        const task = await env.DB.prepare("SELECT video_key,scene_number FROM tasks WHERE id=? AND owner=?").bind(videoMatch[1], owner(request)).first();
        if (!task?.video_key) return json({ error: "视频尚未就绪" }, 404);
        const object = await env.VIDEOS.get(task.video_key);
        return object ? new Response(object.body, { headers: { "content-type": "video/mp4", "content-disposition": `inline; filename=scene-${task.scene_number}.mp4`, "accept-ranges": "bytes" } }) : json({ error: "视频文件不存在" }, 404);
      }
      return json({ error: "Not found" }, 404);
    } catch (error) { return json({ error: error?.message || String(error) }, 500); }
  }
};
