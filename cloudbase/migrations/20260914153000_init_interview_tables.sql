-- ============================================================
-- AI 人生采访者 · 初始化三张业务表
--
-- 归属一律由数据库决定：owner_id 默认取 auth.uid()，浏览器无法伪造；
-- RLS 策略也只认 auth.uid()（绝不用 current_user / current_setting）。
-- ============================================================

-- 1) 最终留下的故事
CREATE TABLE public.stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id varchar(64) NOT NULL DEFAULT auth.uid()::text,
  title text NOT NULL,
  topic text NOT NULL DEFAULT '',
  story_type text NOT NULL DEFAULT 'life_moment',
  story_status text NOT NULL DEFAULT 'saved',
  content text NOT NULL,
  memory jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) 一次采访会话：状态机位置 + 结构化 Memory + 观察快照
CREATE TABLE public.interview_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id varchar(64) NOT NULL DEFAULT auth.uid()::text,
  topic text NOT NULL DEFAULT '',
  topic_seed text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'START',
  story_status text NOT NULL DEFAULT 'developing',
  memory jsonb NOT NULL DEFAULT '{}'::jsonb,
  observer jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_sec integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3) 逐条消息
CREATE TABLE public.interview_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id varchar(64) NOT NULL DEFAULT auth.uid()::text,
  session_id uuid NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  seq integer NOT NULL DEFAULT 0,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stories_owner_idx ON public.stories (owner_id, created_at DESC);
CREATE INDEX interview_sessions_owner_idx ON public.interview_sessions (owner_id, started_at DESC);
CREATE INDEX interview_messages_session_idx ON public.interview_messages (session_id, seq);

-- 浏览器侧只会有 anon / authenticated 两个角色
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stories TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_sessions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_messages TO anon, authenticated;

ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_messages ENABLE ROW LEVEL SECURITY;

-- 四类策略必须齐全：RLS 开启但零策略 = 全部拒绝
CREATE POLICY stories_select_own ON public.stories
  FOR SELECT TO anon, authenticated USING (owner_id = auth.uid()::text);
CREATE POLICY stories_insert_own ON public.stories
  FOR INSERT TO anon, authenticated WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY stories_update_own ON public.stories
  FOR UPDATE TO anon, authenticated
  USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY stories_delete_own ON public.stories
  FOR DELETE TO anon, authenticated USING (owner_id = auth.uid()::text);

CREATE POLICY sessions_select_own ON public.interview_sessions
  FOR SELECT TO anon, authenticated USING (owner_id = auth.uid()::text);
CREATE POLICY sessions_insert_own ON public.interview_sessions
  FOR INSERT TO anon, authenticated WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY sessions_update_own ON public.interview_sessions
  FOR UPDATE TO anon, authenticated
  USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY sessions_delete_own ON public.interview_sessions
  FOR DELETE TO anon, authenticated USING (owner_id = auth.uid()::text);

CREATE POLICY messages_select_own ON public.interview_messages
  FOR SELECT TO anon, authenticated USING (owner_id = auth.uid()::text);
CREATE POLICY messages_insert_own ON public.interview_messages
  FOR INSERT TO anon, authenticated WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY messages_update_own ON public.interview_messages
  FOR UPDATE TO anon, authenticated
  USING (owner_id = auth.uid()::text) WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY messages_delete_own ON public.interview_messages
  FOR DELETE TO anon, authenticated USING (owner_id = auth.uid()::text);
