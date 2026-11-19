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
