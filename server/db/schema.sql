CREATE TABLE IF NOT EXISTS chat_users (
  id bigint PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  model_key text NOT NULL,
  oauth_access text NOT NULL,
  oauth_refresh text NOT NULL,
  oauth_expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_login_attempts (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  token_hash text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES chat_users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_login_attempts_expiry ON chat_login_attempts (expires_at);
CREATE INDEX IF NOT EXISTS chat_sessions_expiry ON chat_sessions (expires_at);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES chat_users ON DELETE CASCADE,
  title text NOT NULL,
  model text NOT NULL,
  pinned boolean NOT NULL DEFAULT false,
  source text,
  source_id text,
  origin jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source, source_id)
);

CREATE INDEX IF NOT EXISTS conversations_user_updated ON conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_turns (
  conversation_id uuid NOT NULL REFERENCES conversations ON DELETE CASCADE,
  id text NOT NULL,
  position bigint GENERATED ALWAYS AS IDENTITY,
  payload jsonb NOT NULL,
  PRIMARY KEY (conversation_id, id)
);

CREATE INDEX IF NOT EXISTS chat_turns_conversation_order ON chat_turns (conversation_id, position);

CREATE TABLE IF NOT EXISTS conversation_files (
  conversation_id uuid NOT NULL REFERENCES conversations ON DELETE CASCADE,
  id text NOT NULL,
  media_type text NOT NULL,
  content bytea NOT NULL,
  PRIMARY KEY (conversation_id, id)
);

CREATE TABLE IF NOT EXISTS agent_profiles (
  user_id bigint PRIMARY KEY REFERENCES chat_users ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Uni',
  persona text NOT NULL DEFAULT '',
  proactive boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'Asia/Shanghai',
  disabled_tools text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS agent_memories (
  id uuid PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES chat_users ON DELETE CASCADE,
  body text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_mcp_servers (
  id uuid PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES chat_users ON DELETE CASCADE,
  url text NOT NULL,
  token text,
  UNIQUE(user_id, url)
);

CREATE TABLE IF NOT EXISTS agent_tasks (
  id uuid PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES chat_users ON DELETE CASCADE,
  title text NOT NULL,
  prompt text NOT NULL,
  model text NOT NULL,
  context jsonb NOT NULL DEFAULT '[]',
  state text NOT NULL CHECK (state IN ('running','waiting','scheduled','done','failed')),
  source text NOT NULL CHECK (source IN ('agent','chat','timer','legacy')),
  conversation_id uuid REFERENCES conversations ON DELETE SET NULL,
  turn_id text,
  reminder jsonb,
  enabled boolean NOT NULL DEFAULT true,
  due_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_tickets (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES agent_tasks ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('agent','chat','timer')),
  prompt text NOT NULL,
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id uuid PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES chat_users ON DELETE CASCADE,
  task_id uuid REFERENCES agent_tasks ON DELETE SET NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_files (
  id uuid PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES chat_users ON DELETE CASCADE,
  name text NOT NULL,
  content bytea NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_messages_user_sequence ON agent_messages(user_id, sequence);
CREATE INDEX IF NOT EXISTS agent_tasks_user_updated ON agent_tasks(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS agent_memories_user ON agent_memories(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS legacy_agent_migrations (
  local_account_id text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES chat_users ON DELETE CASCADE,
  imported_at timestamptz NOT NULL DEFAULT now()
);
