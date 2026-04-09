BEGIN;

ALTER TABLE football_pool.display_ad_settings
  ADD COLUMN IF NOT EXISTS sidebar_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS banner_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS default_banner_message TEXT NULL;

CREATE TABLE IF NOT EXISTS football_pool.organization_display_ad_settings (
  organization_id BIGINT PRIMARY KEY REFERENCES football_pool.organization(id) ON DELETE CASCADE,
  ads_enabled_flg BOOLEAN NOT NULL DEFAULT FALSE,
  hide_ads_flg BOOLEAN NOT NULL DEFAULT FALSE,
  frequency_seconds INTEGER NOT NULL DEFAULT 180 CHECK (frequency_seconds BETWEEN 15 AND 3600),
  duration_seconds INTEGER NOT NULL DEFAULT 30 CHECK (duration_seconds BETWEEN 5 AND 600),
  shrink_percent INTEGER NOT NULL DEFAULT 80 CHECK (shrink_percent BETWEEN 50 AND 95),
  sidebar_count INTEGER NOT NULL DEFAULT 1 CHECK (sidebar_count BETWEEN 0 AND 4),
  banner_count INTEGER NOT NULL DEFAULT 1 CHECK (banner_count BETWEEN 0 AND 6),
  default_banner_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE football_pool.display_ad
  ADD COLUMN IF NOT EXISTS placement VARCHAR(16) NOT NULL DEFAULT 'sidebar',
  ADD COLUMN IF NOT EXISTS organization_id BIGINT NULL REFERENCES football_pool.organization(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_display_ad_scope_sort
  ON football_pool.display_ad (organization_id, placement, sort_order, id);

COMMIT;
