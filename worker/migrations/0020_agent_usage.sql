-- The managed agent's spending (TEMPRA-222; tempra-dev: agents/managed-agent, Guard rails): per
-- account and UTC day, what its turns cost at list price, in millionths of a dollar, from each
-- model response's usage; checked against users.limits' agent_daily_usd before every model call.
CREATE TABLE agent_usage (
  user TEXT NOT NULL,
  day TEXT NOT NULL,
  micro_usd INTEGER NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user, day)
);
