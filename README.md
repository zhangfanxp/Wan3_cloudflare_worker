# Wan3 Cloudflare Worker 视频生成器

使用 Cloudflare Workers 部署的网页应用，通过阿里云百炼 Wan 视频生成 API 批量生成分镜视频。视频由百炼云端生成；本项目不在 Worker 中加载或运行 Wan 模型。

仓库项目名：`Wan3_cloudflare_worker`。Worker 代码位于 `src/`，网页位于 `public/`。根目录的 `app.py` 和 `requirements.txt` 是原来的 macOS Gradio 版本，Cloudflare Worker 部署不使用它们。

## 功能

- 一个批次最多提交 5 个分镜，每个分镜可上传首帧、填写提示词和对白/旁白。
- 可选 Wan3.0 模型、视频时长、横竖屏和音轨。
- 在网页中查询百炼任务状态。
- 任务成功后将 MP4 保存到 Cloudflare R2，可在页面内播放、下载单个视频，或打包 ZIP 下载。
- D1 保存任务状态和元数据；R2 保存视频文件。
- Worker 使用 `APP_PASSWORD` 限制 API 访问，使用 `DASHSCOPE_API_KEY` 调用百炼。两个值都通过 Cloudflare Secrets 配置，不写入代码或 Git。

## 部署前准备

1. 注册 [Cloudflare](https://dash.cloudflare.com/sign-up) 账号并登录。
2. 安装 [Node.js](https://nodejs.org/)（建议当前 LTS）和 Git。Wrangler 通过 `npx` 运行，无需全局安装。
3. 准备阿里云百炼账号，并在百炼控制台创建 API Key、开通 Wan 视频模型权限及账户额度。API Key 可以稍后设置；没有它时网页能打开，但不能提交生成任务。
4. 在 Cloudflare 开通 R2。第一次创建 bucket 时，Cloudflare 可能要求启用 R2 或完成计费设置。
5. 如果使用自定义域名：把域名加入 Cloudflare，并确保对应 Zone 为 Active。自定义域名必须属于当前登录账号中的 Cloudflare Zone。

## Cloudflare 部署步骤

在终端进入项目目录：

```bash
cd Wan3_cloudflare_worker
```

### 1. 登录 Wrangler

```bash
npx wrangler login
npx wrangler whoami
```

`wrangler login` 会打开浏览器授权。确认登录的是要部署到的 Cloudflare 账号，并允许 Wrangler 访问。

### 2. 创建 R2 bucket

先在 Cloudflare Dashboard 的 **R2** 页面启用 R2（如尚未开通），然后创建本项目使用的 bucket：

```bash
npx wrangler r2 bucket create wan-video-product-videos
```

Bucket 名称需与 `wrangler.jsonc` 的 `r2_buckets[].bucket_name` 一致。如果改了名称，也要同步修改配置。

### 3. 创建 D1 数据库并配置绑定

创建数据库：

```bash
npx wrangler d1 create wan-video-product
```

命令会返回 `database_id`。将它填入 `wrangler.jsonc` 的 `d1_databases[0].database_id`，并确认 `database_name` 与刚创建的名称一致。不要把自己的数据库 ID 替换成其他账号的 ID。

### 4. 初始化数据库表

```bash
npx wrangler d1 execute wan-video-product --remote --file=./schema.sql
```

SQL 使用 `CREATE TABLE IF NOT EXISTS`，可安全重复执行。

### 5. 配置应用访问密码和百炼 API Key

```bash
npx wrangler secret put APP_PASSWORD
npx wrangler secret put DASHSCOPE_API_KEY
```

每条命令会分别提示输入 Secret 值。请不要把密钥写入 `wrangler.jsonc`、README、源码或 GitHub。`APP_PASSWORD` 是应用 API 的访问密码；`DASHSCOPE_API_KEY` 是阿里百炼 API Key。可先只设置 `APP_PASSWORD`，稍后再添加百炼 API Key。

替换 API Key 时重复运行：

```bash
npx wrangler secret put DASHSCOPE_API_KEY
```

### 6. 配置自定义域名（可选）

`wrangler.jsonc` 中的 `routes` 当前示例绑定为 `video.frank1994.cc.cd`。使用其他域名时，把 `pattern` 改成你自己的完整主机名，例如 `video.example.com`。需确保该主机名属于当前 Cloudflare 账号的 Active Zone，且没有冲突的 CNAME/DNS 配置。

```jsonc
"routes": [{ "pattern": "video.example.com", "custom_domain": true }]
```

Cloudflare Custom Domain 会为 Worker 创建所需 DNS 记录并配置证书。若不使用自定义域名，可删除 `routes` 配置，并在部署时使用 `workers.dev` 地址。

### 7. 部署

```bash
npx wrangler deploy
```

部署输出会显示 Worker URL 或 Custom Domain。打开网址，输入 `APP_PASSWORD` 后即可使用。更改源码后再次执行 `npx wrangler deploy` 即可发布新版本。

## 使用方法

1. 打开已部署的 Worker 地址并输入应用访问密码。
2. 选择模型和分镜数量（最多 5 个）。
3. 每个分镜上传首帧图片，填写提示词；对白/旁白可选。
4. 选择时长、横竖屏和是否生成音轨。
5. 点击 **提交视频生成**。未填写首帧或提示词的分镜会跳过。
6. 生成期间点击对应任务的 **查询状态**。百炼任务状态由页面主动查询，不会在后台持续轮询。
7. 成功后可点击 **页面播放**、**下载视频**，或点击 **下载成功视频 ZIP** 一次打包已完成的分镜。

## 配置说明

| 配置 | 位置 | 说明 |
| --- | --- | --- |
| Worker 名称、入口、静态资源 | `wrangler.jsonc` | 当前 Worker 名称为 `wan-video-product` |
| D1 数据库 | `wrangler.jsonc` | 创建数据库后填入自己的 `database_id` |
| R2 bucket | `wrangler.jsonc` | 默认 `wan-video-product-videos` |
| 自定义域名 | `wrangler.jsonc` | 当前示例为 `video.frank1994.cc.cd` |
| 百炼 API Key | Cloudflare Secret `DASHSCOPE_API_KEY` | 不写入前端或数据库 |
| 应用访问密码 | Cloudflare Secret `APP_PASSWORD` | 前端使用会话级 `sessionStorage` 缓存 |

Worker 当前使用北京地域的视频生成与任务查询接口。若百炼 API Key/模型属于其他地域，请按百炼控制台的地域要求调整 `src/index.js` 中的视频生成和任务查询地址。

## 本地开发

配置 `wrangler.jsonc` 中 D1 和 R2 绑定后：

```bash
npx wrangler dev
```

本地开发环境也需要设置 Secrets（可用 Wrangler Secret 或 `.dev.vars`）。`.dev.vars` 已被 `.gitignore` 排除，切勿提交密钥。

## 文件与数据

- `src/index.js`：Worker API，实现百炼任务提交、任务查询、R2 保存和视频下载。
- `public/index.html`：网页界面、视频播放器和浏览器端 ZIP 打包。
- `schema.sql`：D1 任务表结构。
- D1 保存任务元数据；R2 保存生成的 MP4。原始首帧在提交请求中传给百炼，不作为历史图片归档。

## 安全与限制

- 不要公开 `APP_PASSWORD` 或 `DASHSCOPE_API_KEY`。如果 API Key 意外泄露，请立即在百炼控制台撤销并重新生成。
- 当前访问控制是单个共享密码，适合个人或小范围使用，不包含原 Gradio 版的多账号、角色管理和管理员操作日志功能。
- 任务按页面点击主动查询；关闭网页后不会自动刷新任务状态。重新打开后可用同一浏览器查看其本地客户端 ID 对应的任务。
- ZIP 在用户浏览器中打包，需要浏览器能够访问 JSZip CDN，并会暂存下载的视频数据；批量视频很大时请分批下载。
- Worker 视频下载端点需要携带应用密码；网页内的播放和下载按钮会自动携带认证信息。直接复制视频 API 地址到新标签页不会自动认证。
- 百炼调用受模型权限、地域、额度、计费和接口可用性影响。
- macOS Gradio 版本仍可按旧版说明运行，但该版本的数据和 Cloudflare Worker 版本的数据不互通。

## GitHub 发布

首次发布到自己的新仓库时，先在 GitHub 创建 `Wan3_cloudflare_worker` 仓库，然后：

```bash
git remote rename origin upstream
git remote add origin https://github.com/<你的GitHub用户名>/Wan3_cloudflare_worker.git
git add README.md .gitignore wrangler.jsonc schema.sql src/index.js public/index.html
git status --short
git commit -m "Deploy Wan video app on Cloudflare Workers"
git push -u origin main
```

提交前确认没有 `.dev.vars`、`.env`、API Key、Wrangler 凭据、生成视频或其他私人数据。
