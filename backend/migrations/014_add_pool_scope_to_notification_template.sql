ALTER TABLE football_pool.notification_template
  ADD COLUMN IF NOT EXISTS pool_id INTEGER NULL REFERENCES football_pool.pool(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_template_pkey'
      AND conrelid = 'football_pool.notification_template'::regclass
  ) THEN
    ALTER TABLE football_pool.notification_template
      DROP CONSTRAINT notification_template_pkey;
  END IF;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

DROP INDEX IF EXISTS football_pool.idx_notification_template_recipient_kind;

DELETE FROM football_pool.notification_template a
USING football_pool.notification_template b
WHERE a.ctid < b.ctid
  AND COALESCE(a.pool_id, -1) = COALESCE(b.pool_id, -1)
  AND a.recipient_scope = b.recipient_scope
  AND a.notification_kind = b.notification_kind;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_template_global_unique
  ON football_pool.notification_template (recipient_scope, notification_kind)
  WHERE pool_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_template_pool_unique
  ON football_pool.notification_template (pool_id, recipient_scope, notification_kind)
  WHERE pool_id IS NOT NULL;
