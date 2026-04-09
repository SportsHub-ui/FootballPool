BEGIN;

CREATE TABLE IF NOT EXISTS football_pool.display_ad_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ads_enabled_flg BOOLEAN NOT NULL DEFAULT FALSE,
  frequency_seconds INTEGER NOT NULL DEFAULT 180 CHECK (frequency_seconds BETWEEN 15 AND 3600),
  duration_seconds INTEGER NOT NULL DEFAULT 30 CHECK (duration_seconds BETWEEN 5 AND 600),
  shrink_percent INTEGER NOT NULL DEFAULT 80 CHECK (shrink_percent BETWEEN 50 AND 95),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO football_pool.display_ad_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS football_pool.display_ad (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  body TEXT NULL,
  footer VARCHAR(255) NULL,
  image_url VARCHAR(500) NULL,
  accent_color VARCHAR(32) NULL,
  active_flg BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_display_ad_active_sort
  ON football_pool.display_ad (active_flg, sort_order, id);

COMMIT;
