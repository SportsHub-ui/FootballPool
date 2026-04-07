CREATE TABLE IF NOT EXISTS football_pool.notification_template (
  recipient_scope VARCHAR(20) NOT NULL,
  notification_kind VARCHAR(30) NOT NULL,
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  markup_format VARCHAR(20) NOT NULL DEFAULT 'plain_text',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (recipient_scope, notification_kind)
);

-- Older databases may already have this table without the original PK/unique constraint.
-- Deduplicate any existing rows and recreate a compatible unique index so ON CONFLICT works.
DELETE FROM football_pool.notification_template a
USING football_pool.notification_template b
WHERE a.ctid < b.ctid
  AND a.recipient_scope = b.recipient_scope
  AND a.notification_kind = b.notification_kind;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_template_recipient_kind
  ON football_pool.notification_template (recipient_scope, notification_kind);

INSERT INTO football_pool.notification_template (
  recipient_scope,
  notification_kind,
  subject_template,
  body_template,
  markup_format,
  updated_at
)
VALUES
  (
    'participant',
    'quarter_win',
    'You won Q{{quarter}} in {{poolName}}',
    E'Hi {{recipientName}},\n\nYour square #{{squareNum}} won quarter {{quarter}} in {{poolName}}.\n{{scoreLine}}\nQuarter payout: {{payout}}',
    'plain_text',
    NOW()
  ),
  (
    'participant',
    'game_total',
    'Final winnings for {{poolName}}',
    E'Hi {{recipientName}},\n\nThe game in {{poolName}} has ended.\nYour total winnings: {{totalWon}}\n\n{{winningsBreakdown}}',
    'plain_text',
    NOW()
  ),
  (
    'participant',
    'lead_warning',
    'Your square is currently leading in {{poolName}}',
    E'Hi {{recipientName}},\n\nSquare #{{squareNum}} would win quarter {{quarter}} in {{poolName}} if it ended right now.\nCurrent score: {{scoreLine}}',
    'plain_text',
    NOW()
  ),
  (
    'pool_contact',
    'quarter_win',
    'Q{{quarter}} winner for {{poolName}}',
    E'Hi {{recipientName}},\n\n{{winnerName}} won quarter {{quarter}} in {{poolName}}.\nWinning square: #{{squareNum}}\n{{scoreLine}}\nQuarter payout: {{payout}}',
    'plain_text',
    NOW()
  ),
  (
    'pool_contact',
    'game_total',
    'Game final summary for {{poolName}}',
    E'Hi {{recipientName}},\n\nThe {{poolName}} game has ended. Final winnings summary:\n\n{{winningsBreakdown}}',
    'plain_text',
    NOW()
  ),
  (
    'pool_contact',
    'lead_warning',
    'Live square leader for {{poolName}}',
    E'Hi {{recipientName}},\n\n{{leaderName}} on square #{{squareNum}} would win quarter {{quarter}} in {{poolName}} if the quarter ended now.\nCurrent score: {{scoreLine}}',
    'plain_text',
    NOW()
  )
ON CONFLICT (recipient_scope, notification_kind) DO NOTHING;
