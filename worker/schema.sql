-- PXAX · Ai — схема D1 (применяется один раз: wrangler d1 execute pxaxai)

CREATE TABLE IF NOT EXISTS users (
  user_key TEXT PRIMARY KEY,
  state TEXT,
  memory TEXT,
  push_chat INTEGER,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS cron_meta (
  k TEXT PRIMARY KEY,
  v TEXT
);

CREATE TABLE IF NOT EXISTS codes (
  code TEXT PRIMARY KEY,
  credits INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  redeemed TEXT
);

-- кросс-экосистемные дропы (каждый код одноразовый)
INSERT OR IGNORE INTO codes (code, credits, max_uses, uses, message) VALUES
  ('PXAX-BETPAY', 40, 1, 0, 'Код из PXAXBET · +40 ◈'),
  ('PXAX-PREDICT', 40, 1, 0, 'Код из AI-прогнозов · +40 ◈'),
  ('PXAX-VPH', 40, 1, 0, 'Код из Vph · +40 ◈'),
  ('PXAX-NOW', 60, 1, 0, 'Праздничный код · +60 ◈');