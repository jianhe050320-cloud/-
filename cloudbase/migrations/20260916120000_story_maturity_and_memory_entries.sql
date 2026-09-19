-- ============================================================
-- Phase 1：内容成熟度 / 记忆线程 / 事实地图 / 来源链 + 记忆入口表
--
-- 归属仍然只认 auth.uid()：owner_id 默认取 auth.uid()，浏览器无法伪造。
-- 本迁移只做「新增」，不改动、不删除既有列，保证老数据可读。
-- ============================================================

-- 1) stories：补齐内容成熟度、记忆线程、事实地图、来源链
--    kind      内容成熟度：fragment / full（不含 seed —— seed 落 memory_entries）
--    thread_id 记忆线程（修正2）：同一个人生故事的多次讲述归到一个 thread
--    outline   事实地图（修正7）：StoryOutline JSON
--    ai_draft  AI 整理版（修正6）：与用户编辑后的 content 分离，避免用户文学表达被当成事实来源
--    source_message_ids 来源用户消息 id（修正6）
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS thread_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS outline jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_draft text,
  ADD COLUMN IF NOT EXISTS source_message_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS stories_thread_idx ON public.stories (owner_id, thread_id);

-- 2) 记忆入口（修正1）：AI 听见并保存的材料
--    type 只有 seed / note —— fragment / full 属于 stories.kind，不在这里出现
CREATE TABLE IF NOT EXISTS public.memory_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id varchar(64) NOT NULL DEFAULT auth.uid()::text,
  thread_id text NOT NULL DEFAULT '',
  session_id uuid,
  topic_id text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'seed' CHECK (type IN ('seed', 'note')),
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  user_quotes jsonb NOT NULL DEFAULT '[]'::jsonb,
  people jsonb NOT NULL DEFAULT '[]'::jsonb,
  emotions jsonb NOT NULL DEFAULT '[]'::jsonb,
  topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_message_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  worth_saving boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'developed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_entries_owner_idx ON public.memory_entries (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS memory_entries_thread_idx ON public.memory_entries (owner_id, thread_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_entries TO anon, authenticated;

ALTER TABLE public.memory_entries ENABLE ROW LEVEL SECURITY;

-- 四类策略必须齐全：RLS 开启但零策略 = 全部拒绝
CREATE POLICY memory_entries_select_own ON public.memory_entries
  FOR SELECT TO anon, authenticated USING (owner_id = auth.uid()::text);
CREATE POLICY memory_entries_insert_own ON public.memory_entries
  FOR INSERT TO anon, authenticated WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY memory_entries_update_own ON public.memory_entries
  FOR UPDATE TO anon, authenticated
  USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY memory_entries_delete_own ON public.memory_entries
  FOR DELETE TO anon, authenticated USING (owner_id = auth.uid()::text);
