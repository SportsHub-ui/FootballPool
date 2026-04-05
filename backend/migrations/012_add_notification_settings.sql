ALTER TABLE football_pool.users
  ADD COLUMN IF NOT EXISTS notification_level VARCHAR(20) NOT NULL DEFAULT 'none';

ALTER TABLE football_pool.users
  ADD COLUMN IF NOT EXISTS notify_on_square_lead_flg BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE football_pool.users
SET notification_level = 'none'
WHERE notification_level IS NULL
   OR notification_level NOT IN ('none', 'quarter_win', 'game_total');

UPDATE football_pool.users
SET notify_on_square_lead_flg = COALESCE(notify_on_square_lead_flg, FALSE);

ALTER TABLE football_pool.pool
  ADD COLUMN IF NOT EXISTS contact_notification_level VARCHAR(20) NOT NULL DEFAULT 'none';

ALTER TABLE football_pool.pool
  ADD COLUMN IF NOT EXISTS contact_notify_on_square_lead_flg BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE football_pool.pool
SET contact_notification_level = 'none'
WHERE contact_notification_level IS NULL
   OR contact_notification_level NOT IN ('none', 'quarter_win', 'game_total');

UPDATE football_pool.pool
SET contact_notify_on_square_lead_flg = COALESCE(contact_notify_on_square_lead_flg, FALSE);

CREATE TABLE IF NOT EXISTS football_pool.notification_log (
  id BIGSERIAL PRIMARY KEY,
  dedupe_key VARCHAR(200) NOT NULL UNIQUE,
  notification_kind VARCHAR(30) NOT NULL,
  recipient_scope VARCHAR(20) NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  recipient_user_id INTEGER NULL REFERENCES football_pool.users(id) ON DELETE SET NULL,
  pool_id INTEGER NOT NULL REFERENCES football_pool.pool(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES football_pool.game(id) ON DELETE CASCADE,
  quarter INTEGER NULL,
  square_num INTEGER NULL,
  subject VARCHAR(255) NOT NULL,
  message_text TEXT NOT NULL,
  payload_json JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_log_game_created
  ON football_pool.notification_log (game_id, created_at DESC);
