-- Agent identity (tempra-dev: decisions/agents-act-for-a-person, TEMPRA-75): each person's agents,
-- one per platform they connect from (claude.ai, chatgpt.com, a CLI on their computer, a token's
-- app). The id is derived from (user, platform), so requests never look it up; this table names
-- agents and records what they said about themselves. Never used to authorize anything.
CREATE TABLE agents (
  id         TEXT PRIMARY KEY,
  user       TEXT NOT NULL REFERENCES users(id),
  platform   TEXT NOT NULL,
  name       TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  -- What the client last said at MCP initialize (clientInfo name and version), and its User-Agent.
  client     TEXT,
  user_agent TEXT,
  UNIQUE (user, platform)
);
