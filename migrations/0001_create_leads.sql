-- Leads captured by the briefing request form on xsim.dev
CREATE TABLE IF NOT EXISTS leads (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,             -- ISO 8601, UTC
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  company       TEXT NOT NULL,
  role          TEXT NOT NULL,
  team_size     TEXT,
  phone         TEXT,
  message       TEXT,
  pref_language TEXT,                      -- language the lead prefers for the meeting
  page_language TEXT,                      -- language of the page they submitted from
  country       TEXT,                      -- two-letter country from Cloudflare, no IP stored
  consent       INTEGER NOT NULL DEFAULT 0,
  emailed       INTEGER NOT NULL DEFAULT 0, -- 1 if the notification email was sent
  status        TEXT NOT NULL DEFAULT 'new' -- new | contacted | meeting | qualified | closed
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads (email);
