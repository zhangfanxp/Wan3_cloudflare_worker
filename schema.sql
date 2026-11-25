CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  scene_number INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  dashscope_task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  video_key TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_owner_created ON tasks(owner, created_at DESC);
