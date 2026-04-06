import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { env } from '../config/env';
import {
  DEFAULT_NOTIFICATION_TEMPLATES,
  getNotificationTemplateMap,
  renderMarkupToHtml,
  renderNotificationTemplate,
  type NotificationTemplateKind as NotificationKind,
  type NotificationTemplateScope
} from './notificationTemplates';

export const notificationLevelValues = ['none', 'quarter_win', 'game_total'] as const;
export type NotificationLevel = (typeof notificationLevelValues)[number];

type WinnerSnapshot = {
  winnerUserId: number | null;
  amountWon: number | null;
};

export type QuarterNotificationResult = {
  quarter: number;
  payout: number;
  squareNum: number | null;
  winnerUserId: number | null;
  primaryScore: number | null;
  opponentScore: number | null;
};

export type LiveLeaderState = {
  quarter: number;
  squareNum: number;
  primaryScore: number | null;
  opponentScore: number | null;
};

export type ScoreNotificationContext = {
  gameId: number;
  poolId: number;
  quarters: QuarterNotificationResult[];
  previousWinners: Map<number, WinnerSnapshot>;
  currentLeader: LiveLeaderState | null;
  previousLeader: LiveLeaderState | null;
  gameComplete: boolean;
};

type RecipientScope = 'user' | 'pool_contact';

type Recipient = {
  scope: RecipientScope;
  email: string;
  userId: number | null;
  name: string;
};

type UserPreferenceRecord = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  notification_level: string | null;
  notify_on_square_lead_flg: boolean | null;
};

type PoolNotificationRecord = {
  pool_name: string | null;
  primary_team: string | null;
  contact_notification_level: string | null;
  contact_notify_on_square_lead_flg: boolean | null;
  team_name: string | null;
  primary_contact_id: number | null;
  secondary_contact_id: number | null;
  primary_contact_email: string | null;
  primary_contact_first_name: string | null;
  primary_contact_last_name: string | null;
  secondary_contact_email: string | null;
  secondary_contact_first_name: string | null;
  secondary_contact_last_name: string | null;
};

type GameLabelRecord = {
  opponent: string | null;
};

type LeaderSquareRecord = {
  participant_id: number | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  notification_level: string | null;
  notify_on_square_lead_flg: boolean | null;
};

type DeliverEmailArgs = {
  recipientEmail: string;
  subject: string;
  messageText: string;
  messageHtml?: string;
};

type LoggedNotificationArgs = {
  dedupeKey: string;
  kind: NotificationKind;
  recipient: Recipient;
  poolId: number;
  gameId: number;
  quarter: number | null;
  squareNum: number | null;
  subject: string;
  messageText: string;
  messageHtml?: string;
  payload: Record<string, unknown>;
};

let ensureNotificationSupportPromise: Promise<void> | null = null;
let mailTransportPromise: Promise<unknown | null> | null = null;

export const normalizeNotificationLevel = (value: unknown): NotificationLevel => {
  if (value === 'quarter_win' || value === 'game_total') {
    return value;
  }

  return 'none';
};

export const ensureNotificationSupport = async (client: PoolClient): Promise<void> => {
  if (!ensureNotificationSupportPromise) {
    ensureNotificationSupportPromise = (async () => {
      await client.query(`
        ALTER TABLE football_pool.users
        ADD COLUMN IF NOT EXISTS notification_level VARCHAR(20)
      `);

      await client.query(`
        ALTER TABLE football_pool.users
        ADD COLUMN IF NOT EXISTS notify_on_square_lead_flg BOOLEAN DEFAULT FALSE
      `);

      await client.query(`
        UPDATE football_pool.users
        SET notification_level = 'none'
        WHERE notification_level IS NULL
           OR notification_level NOT IN ('none', 'quarter_win', 'game_total')
      `);

      await client.query(`
        UPDATE football_pool.users
        SET notify_on_square_lead_flg = COALESCE(notify_on_square_lead_flg, FALSE)
      `);

      await client.query(`
        ALTER TABLE football_pool.users
        ALTER COLUMN notification_level SET DEFAULT 'none'
      `);

      await client.query(`
        ALTER TABLE football_pool.users
        ALTER COLUMN notify_on_square_lead_flg SET DEFAULT FALSE
      `);

      await client.query(`
        ALTER TABLE football_pool.pool
        ADD COLUMN IF NOT EXISTS contact_notification_level VARCHAR(20)
      `);

      await client.query(`
        ALTER TABLE football_pool.pool
        ADD COLUMN IF NOT EXISTS contact_notify_on_square_lead_flg BOOLEAN DEFAULT FALSE
      `);

      await client.query(`
        UPDATE football_pool.pool
        SET contact_notification_level = 'none'
        WHERE contact_notification_level IS NULL
           OR contact_notification_level NOT IN ('none', 'quarter_win', 'game_total')
      `);

      await client.query(`
        UPDATE football_pool.pool
        SET contact_notify_on_square_lead_flg = COALESCE(contact_notify_on_square_lead_flg, FALSE)
      `);

      await client.query(`
        ALTER TABLE football_pool.pool
        ALTER COLUMN contact_notification_level SET DEFAULT 'none'
      `);

      await client.query(`
        ALTER TABLE football_pool.pool
        ALTER COLUMN contact_notify_on_square_lead_flg SET DEFAULT FALSE
      `);

      await client.query(`
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
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_notification_log_game_created
          ON football_pool.notification_log (game_id, created_at DESC)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS football_pool.notification_template (
          recipient_scope VARCHAR(20) NOT NULL,
          notification_kind VARCHAR(30) NOT NULL,
          subject_template TEXT NOT NULL,
          body_template TEXT NOT NULL,
          markup_format VARCHAR(20) NOT NULL DEFAULT 'plain_text',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`
        ALTER TABLE football_pool.notification_template
        ADD COLUMN IF NOT EXISTS pool_id INTEGER NULL REFERENCES football_pool.pool(id) ON DELETE CASCADE
      `);

      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'notification_template_pkey'
              AND conrelid = 'football_pool.notification_template'::regclass
          ) THEN
            ALTER TABLE football_pool.notification_template DROP CONSTRAINT notification_template_pkey;
          END IF;
        EXCEPTION
          WHEN undefined_table THEN NULL;
        END $$;
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_template_global_unique
          ON football_pool.notification_template (recipient_scope, notification_kind)
          WHERE pool_id IS NULL
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_template_pool_unique
          ON football_pool.notification_template (pool_id, recipient_scope, notification_kind)
          WHERE pool_id IS NOT NULL
      `);

      for (const [recipientScope, templatesByKind] of Object.entries(DEFAULT_NOTIFICATION_TEMPLATES) as Array<
        [NotificationTemplateScope, (typeof DEFAULT_NOTIFICATION_TEMPLATES)[NotificationTemplateScope]]
      >) {
        for (const [notificationKind, template] of Object.entries(templatesByKind) as Array<
          [NotificationKind, (typeof templatesByKind)[NotificationKind]]
        >) {
          await client.query(
            `INSERT INTO football_pool.notification_template (
               pool_id,
               recipient_scope,
               notification_kind,
               subject_template,
               body_template,
               markup_format,
               updated_at
             )
             SELECT NULL,
                    $1::varchar(20),
                    $2::varchar(30),
                    $3::text,
                    $4::text,
                    $5::varchar(20),
                    NOW()
             WHERE NOT EXISTS (
               SELECT 1
               FROM football_pool.notification_template
               WHERE pool_id IS NULL
                 AND recipient_scope = $1::varchar(20)
                 AND notification_kind = $2::varchar(30)
             )`,
            [recipientScope, notificationKind, template.subjectTemplate, template.bodyTemplate, template.markupFormat]
          );
        }
      }
    })();
  }

  try {
    await ensureNotificationSupportPromise;
  } catch (error) {
    ensureNotificationSupportPromise = null;
    throw error;
  }
};

const formatMoney = (value: number): string => `$${Math.max(0, Number(value || 0)).toLocaleString()}`;

const formatPersonName = (firstName: string | null | undefined, lastName: string | null | undefined, fallback: string): string => {
  const fullName = `${firstName ?? ''} ${lastName ?? ''}`.trim();
  return fullName || fallback;
};

const hashKey = (...parts: Array<string | number | null | undefined>): string =>
  createHash('sha1')
    .update(parts.map((part) => String(part ?? '')).join('|'))
    .digest('hex');

const getMailTransport = async (): Promise<unknown | null> => {
  if (env.APP_ENV === 'test' || process.env.NODE_ENV === 'test' || !env.EMAIL_NOTIFICATIONS_ENABLED || !env.SMTP_HOST) {
    return null;
  }

  if (!mailTransportPromise) {
    mailTransportPromise = (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nodemailer = require('nodemailer');
        return nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          auth: env.SMTP_USER
            ? {
                user: env.SMTP_USER,
                pass: env.SMTP_PASS || undefined
              }
            : undefined
        });
      } catch (error) {
        console.warn('[notifications] SMTP transport unavailable, email will be logged only.', error);
        return null;
      }
    })();
  }

  return mailTransportPromise;
};

const deliverEmail = async ({ recipientEmail, subject, messageText, messageHtml }: DeliverEmailArgs): Promise<void> => {
  const transport = await getMailTransport();

  if (!transport || typeof transport !== 'object' || typeof (transport as { sendMail?: unknown }).sendMail !== 'function') {
    console.info(`[email-notification] to=${recipientEmail} subject=${subject}\n${messageText}`);
    return;
  }

  try {
    await (transport as { sendMail: (mail: Record<string, unknown>) => Promise<unknown> }).sendMail({
      from: env.EMAIL_FROM,
      to: recipientEmail,
      subject,
      text: messageText,
      html: messageHtml
    });
    console.info(`[email-notification] delivered to=${recipientEmail} subject=${subject}`);
  } catch (error) {
    console.error(`[notifications] Failed to send email to ${recipientEmail}`, error);
  }
};

const logAndDeliverNotification = async (client: PoolClient, args: LoggedNotificationArgs): Promise<boolean> => {
  const insertResult = await client.query(
    `INSERT INTO football_pool.notification_log (
       dedupe_key,
       notification_kind,
       recipient_scope,
       recipient_email,
       recipient_user_id,
       pool_id,
       game_id,
       quarter,
       square_num,
       subject,
       message_text,
       payload_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [
      args.dedupeKey,
      args.kind,
      args.recipient.scope,
      args.recipient.email,
      args.recipient.userId,
      args.poolId,
      args.gameId,
      args.quarter,
      args.squareNum,
      args.subject,
      args.messageText,
      JSON.stringify(args.payload)
    ]
  );

  if ((insertResult.rowCount ?? 0) === 0) {
    return false;
  }

  await deliverEmail({
    recipientEmail: args.recipient.email,
    subject: args.subject,
    messageText: args.messageText,
    messageHtml: args.messageHtml
  });

  return true;
};

const loadPoolNotificationRecord = async (client: PoolClient, poolId: number): Promise<PoolNotificationRecord | null> => {
  const result = await client.query<PoolNotificationRecord>(
    `SELECT p.pool_name,
            p.primary_team,
            p.contact_notification_level,
            p.contact_notify_on_square_lead_flg,
            t.team_name,
            t.primary_contact_id,
            t.secondary_contact_id,
            primary_user.email AS primary_contact_email,
            primary_user.first_name AS primary_contact_first_name,
            primary_user.last_name AS primary_contact_last_name,
            secondary_user.email AS secondary_contact_email,
            secondary_user.first_name AS secondary_contact_first_name,
            secondary_user.last_name AS secondary_contact_last_name
     FROM football_pool.pool p
     LEFT JOIN football_pool.team t ON t.id = p.team_id
     LEFT JOIN football_pool.users primary_user ON primary_user.id = t.primary_contact_id
     LEFT JOIN football_pool.users secondary_user ON secondary_user.id = t.secondary_contact_id
     WHERE p.id = $1
     LIMIT 1`,
    [poolId]
  );

  return result.rows[0] ?? null;
};

const buildPoolContactRecipients = (poolRecord: PoolNotificationRecord | null): Recipient[] => {
  if (!poolRecord) {
    return [];
  }

  const recipients: Recipient[] = [];
  const seenEmails = new Set<string>();
  const rawRecipients = [
    {
      email: poolRecord.primary_contact_email,
      userId: poolRecord.primary_contact_id,
      firstName: poolRecord.primary_contact_first_name,
      lastName: poolRecord.primary_contact_last_name
    },
    {
      email: poolRecord.secondary_contact_email,
      userId: poolRecord.secondary_contact_id,
      firstName: poolRecord.secondary_contact_first_name,
      lastName: poolRecord.secondary_contact_last_name
    }
  ];

  for (const entry of rawRecipients) {
    const email = entry.email?.trim();
    if (!email) {
      continue;
    }

    const emailKey = email.toLowerCase();
    if (seenEmails.has(emailKey)) {
      continue;
    }

    seenEmails.add(emailKey);
    recipients.push({
      scope: 'pool_contact',
      email,
      userId: entry.userId != null ? Number(entry.userId) : null,
      name: formatPersonName(entry.firstName, entry.lastName, email)
    });
  }

  return recipients;
};

const loadUsersById = async (client: PoolClient, userIds: number[]): Promise<Map<number, UserPreferenceRecord>> => {
  if (userIds.length === 0) {
    return new Map<number, UserPreferenceRecord>();
  }

  const result = await client.query<UserPreferenceRecord>(
    `SELECT id,
            first_name,
            last_name,
            email,
            notification_level,
            notify_on_square_lead_flg
     FROM football_pool.users
     WHERE id = ANY($1::int[])`,
    [userIds]
  );

  return new Map(result.rows.map((row) => [Number(row.id), row]));
};

const loadGameLabel = async (client: PoolClient, gameId: number): Promise<GameLabelRecord | null> => {
  const result = await client.query<GameLabelRecord>(
    `SELECT opponent
     FROM football_pool.game
     WHERE id = $1
     LIMIT 1`,
    [gameId]
  );

  return result.rows[0] ?? null;
};

const loadLeaderSquareRecord = async (client: PoolClient, poolId: number, squareNum: number): Promise<LeaderSquareRecord | null> => {
  const result = await client.query<LeaderSquareRecord>(
    `SELECT s.participant_id,
            u.first_name,
            u.last_name,
            u.email,
            u.notification_level,
            u.notify_on_square_lead_flg
     FROM football_pool.square s
     LEFT JOIN football_pool.users u ON u.id = s.participant_id
     WHERE s.pool_id = $1
       AND s.square_num = $2
     LIMIT 1`,
    [poolId, squareNum]
  );

  return result.rows[0] ?? null;
};

const buildNotificationContent = (
  templateMap: Map<string, ReturnType<typeof renderNotificationTemplate>['template']>,
  templateScope: NotificationTemplateScope,
  kind: NotificationKind,
  variables: Record<string, unknown>
): { subject: string; messageText: string; messageHtml: string } => {
  const rendered = renderNotificationTemplate({
    templateScope,
    notificationKind: kind,
    variables,
    templateMap
  });

  return {
    subject: rendered.subject,
    messageText: rendered.body,
    messageHtml: renderMarkupToHtml(rendered.body, rendered.markupFormat)
  };
};

export const emitScoreNotifications = async (client: PoolClient, context: ScoreNotificationContext): Promise<void> => {
  await ensureNotificationSupport(client);

  const poolRecord = await loadPoolNotificationRecord(client, context.poolId);
  const gameRecord = await loadGameLabel(client, context.gameId);
  const templateMap = await getNotificationTemplateMap(client, context.poolId);

  if (!poolRecord) {
    return;
  }

  const poolName = poolRecord.pool_name?.trim() || `Pool #${context.poolId}`;
  const primaryTeamName = poolRecord.primary_team?.trim() || poolRecord.team_name?.trim() || 'Primary team';
  const opponentName = gameRecord?.opponent?.trim() || 'the opponent';
  const poolContactLevel = normalizeNotificationLevel(poolRecord.contact_notification_level);
  const poolContactRecipients = buildPoolContactRecipients(poolRecord);

  const quarterWinnerIds = Array.from(
    new Set(
      context.quarters
        .map((quarter) => (quarter.winnerUserId != null ? Number(quarter.winnerUserId) : null))
        .filter((userId): userId is number => userId != null)
    )
  );
  const userRecords = await loadUsersById(client, quarterWinnerIds);

  for (const quarter of context.quarters) {
    if (quarter.squareNum == null || quarter.winnerUserId == null) {
      continue;
    }

    const previousWinner = context.previousWinners.get(quarter.quarter);
    const winnerChanged =
      !previousWinner ||
      Number(previousWinner.winnerUserId ?? 0) !== Number(quarter.winnerUserId) ||
      Number(previousWinner.amountWon ?? 0) !== Number(quarter.payout);

    if (!winnerChanged) {
      continue;
    }

    const winnerUser = userRecords.get(Number(quarter.winnerUserId));
    const winnerName = formatPersonName(winnerUser?.first_name, winnerUser?.last_name, winnerUser?.email ?? `User #${quarter.winnerUserId}`);
    const scoreLine = `${primaryTeamName} ${quarter.primaryScore ?? '—'} · ${opponentName} ${quarter.opponentScore ?? '—'}`;

    if (winnerUser?.email && normalizeNotificationLevel(winnerUser.notification_level) === 'quarter_win') {
      const userNotification = buildNotificationContent(templateMap, 'participant', 'quarter_win', {
        recipientName: winnerName,
        winnerName,
        poolName,
        primaryTeamName,
        opponentName,
        scoreLine,
        quarter: quarter.quarter,
        squareNum: quarter.squareNum,
        payout: formatMoney(quarter.payout)
      });

      await logAndDeliverNotification(client, {
        dedupeKey: hashKey('quarter_win', 'user', context.gameId, quarter.quarter, winnerUser.id, quarter.squareNum, quarter.payout),
        kind: 'quarter_win',
        recipient: {
          scope: 'user',
          email: winnerUser.email,
          userId: Number(winnerUser.id),
          name: winnerName
        },
        poolId: context.poolId,
        gameId: context.gameId,
        quarter: quarter.quarter,
        squareNum: quarter.squareNum,
        subject: userNotification.subject,
        messageText: userNotification.messageText,
        messageHtml: userNotification.messageHtml,
        payload: {
          poolName,
          primaryTeamName,
          opponentName,
          quarter: quarter.quarter,
          squareNum: quarter.squareNum,
          payout: quarter.payout,
          winnerUserId: quarter.winnerUserId
        }
      });
    }

    if (poolContactLevel === 'quarter_win') {
      for (const recipient of poolContactRecipients) {
        const contactNotification = buildNotificationContent(templateMap, 'pool_contact', 'quarter_win', {
          recipientName: recipient.name,
          winnerName,
          poolName,
          primaryTeamName,
          opponentName,
          scoreLine,
          quarter: quarter.quarter,
          squareNum: quarter.squareNum,
          payout: formatMoney(quarter.payout)
        });

        await logAndDeliverNotification(client, {
          dedupeKey: hashKey('quarter_win', recipient.scope, context.gameId, quarter.quarter, recipient.email, quarter.winnerUserId, quarter.squareNum, quarter.payout),
          kind: 'quarter_win',
          recipient,
          poolId: context.poolId,
          gameId: context.gameId,
          quarter: quarter.quarter,
          squareNum: quarter.squareNum,
          subject: contactNotification.subject,
          messageText: contactNotification.messageText,
          messageHtml: contactNotification.messageHtml,
          payload: {
            poolName,
            primaryTeamName,
            opponentName,
            quarter: quarter.quarter,
            squareNum: quarter.squareNum,
            payout: quarter.payout,
            winnerUserId: quarter.winnerUserId,
            winnerName
          }
        });
      }
    }
  }

  if (context.gameComplete) {
    const totalsByUser = new Map<number, { totalWon: number; wins: QuarterNotificationResult[] }>();

    for (const quarter of context.quarters) {
      if (quarter.winnerUserId == null || quarter.squareNum == null) {
        continue;
      }

      const existing = totalsByUser.get(Number(quarter.winnerUserId)) ?? { totalWon: 0, wins: [] };
      existing.totalWon += Number(quarter.payout);
      existing.wins.push(quarter);
      totalsByUser.set(Number(quarter.winnerUserId), existing);
    }

    for (const [userId, summary] of totalsByUser.entries()) {
      const winnerUser = userRecords.get(userId);
      if (!winnerUser?.email || normalizeNotificationLevel(winnerUser.notification_level) !== 'game_total') {
        continue;
      }

      const winnerName = formatPersonName(winnerUser.first_name, winnerUser.last_name, winnerUser.email);
      const breakdown = summary.wins
        .map((quarter) => `Q${quarter.quarter}: ${formatMoney(quarter.payout)} (square #${quarter.squareNum})`)
        .join('\n');

      const totalNotification = buildNotificationContent(templateMap, 'participant', 'game_total', {
        recipientName: winnerName,
        winnerName,
        poolName,
        totalWon: formatMoney(summary.totalWon),
        winningsBreakdown: breakdown
      });

      await logAndDeliverNotification(client, {
        dedupeKey: hashKey('game_total', 'user', context.gameId, userId, summary.totalWon, breakdown),
        kind: 'game_total',
        recipient: {
          scope: 'user',
          email: winnerUser.email,
          userId,
          name: winnerName
        },
        poolId: context.poolId,
        gameId: context.gameId,
        quarter: null,
        squareNum: null,
        subject: totalNotification.subject,
        messageText: totalNotification.messageText,
        messageHtml: totalNotification.messageHtml,
        payload: {
          poolName,
          totalWon: summary.totalWon,
          quarters: summary.wins.map((quarter) => ({
            quarter: quarter.quarter,
            payout: quarter.payout,
            squareNum: quarter.squareNum
          }))
        }
      });
    }

    if (poolContactLevel === 'game_total' && poolContactRecipients.length > 0 && totalsByUser.size > 0) {
      const summaryLines = Array.from(totalsByUser.entries())
        .map(([userId, summary]) => {
          const winnerUser = userRecords.get(userId);
          const winnerName = formatPersonName(winnerUser?.first_name, winnerUser?.last_name, winnerUser?.email ?? `User #${userId}`);
          return `${winnerName}: ${formatMoney(summary.totalWon)}`;
        })
        .join('\n');

      for (const recipient of poolContactRecipients) {
        const summaryNotification = buildNotificationContent(templateMap, 'pool_contact', 'game_total', {
          recipientName: recipient.name,
          poolName,
          winningsBreakdown: summaryLines
        });

        await logAndDeliverNotification(client, {
          dedupeKey: hashKey('game_total', recipient.scope, context.gameId, recipient.email, summaryLines),
          kind: 'game_total',
          recipient,
          poolId: context.poolId,
          gameId: context.gameId,
          quarter: null,
          squareNum: null,
          subject: summaryNotification.subject,
          messageText: summaryNotification.messageText,
          messageHtml: summaryNotification.messageHtml,
          payload: {
            poolName,
            winners: Array.from(totalsByUser.entries()).map(([userId, summary]) => ({ userId, totalWon: summary.totalWon }))
          }
        });
      }
    }
  }

  const leaderChanged =
    context.currentLeader != null &&
    (context.previousLeader == null ||
      context.previousLeader.quarter !== context.currentLeader.quarter ||
      context.previousLeader.squareNum !== context.currentLeader.squareNum);

  if (!leaderChanged || context.currentLeader == null) {
    return;
  }

  const leaderSquare = await loadLeaderSquareRecord(client, context.poolId, context.currentLeader.squareNum);
  if (!leaderSquare?.participant_id) {
    return;
  }

  const leaderName = formatPersonName(leaderSquare.first_name, leaderSquare.last_name, leaderSquare.email ?? `User #${leaderSquare.participant_id}`);
  const leadScoreLine = `${primaryTeamName} ${context.currentLeader.primaryScore ?? '—'} · ${opponentName} ${context.currentLeader.opponentScore ?? '—'}`;

  if (leaderSquare.email && Boolean(leaderSquare.notify_on_square_lead_flg)) {
    const leadNotification = buildNotificationContent(templateMap, 'participant', 'lead_warning', {
      recipientName: leaderName,
      leaderName,
      poolName,
      primaryTeamName,
      opponentName,
      scoreLine: leadScoreLine,
      quarter: context.currentLeader.quarter,
      squareNum: context.currentLeader.squareNum
    });

    await logAndDeliverNotification(client, {
      dedupeKey: hashKey(
        'lead_warning',
        'user',
        context.gameId,
        context.currentLeader.quarter,
        leaderSquare.participant_id,
        context.currentLeader.squareNum,
        context.currentLeader.primaryScore,
        context.currentLeader.opponentScore
      ),
      kind: 'lead_warning',
      recipient: {
        scope: 'user',
        email: leaderSquare.email,
        userId: Number(leaderSquare.participant_id),
        name: leaderName
      },
      poolId: context.poolId,
      gameId: context.gameId,
      quarter: context.currentLeader.quarter,
      squareNum: context.currentLeader.squareNum,
      subject: leadNotification.subject,
      messageText: leadNotification.messageText,
      messageHtml: leadNotification.messageHtml,
      payload: {
        poolName,
        quarter: context.currentLeader.quarter,
        squareNum: context.currentLeader.squareNum,
        primaryScore: context.currentLeader.primaryScore,
        opponentScore: context.currentLeader.opponentScore
      }
    });
  }

  if (Boolean(poolRecord.contact_notify_on_square_lead_flg)) {
    for (const recipient of poolContactRecipients) {
      const contactLeadNotification = buildNotificationContent(templateMap, 'pool_contact', 'lead_warning', {
        recipientName: recipient.name,
        leaderName,
        poolName,
        primaryTeamName,
        opponentName,
        scoreLine: leadScoreLine,
        quarter: context.currentLeader.quarter,
        squareNum: context.currentLeader.squareNum
      });

      await logAndDeliverNotification(client, {
        dedupeKey: hashKey(
          'lead_warning',
          recipient.scope,
          context.gameId,
          context.currentLeader.quarter,
          recipient.email,
          context.currentLeader.squareNum,
          context.currentLeader.primaryScore,
          context.currentLeader.opponentScore
        ),
        kind: 'lead_warning',
        recipient,
        poolId: context.poolId,
        gameId: context.gameId,
        quarter: context.currentLeader.quarter,
        squareNum: context.currentLeader.squareNum,
        subject: contactLeadNotification.subject,
        messageText: contactLeadNotification.messageText,
        messageHtml: contactLeadNotification.messageHtml,
        payload: {
          poolName,
          leaderName,
          quarter: context.currentLeader.quarter,
          squareNum: context.currentLeader.squareNum,
          primaryScore: context.currentLeader.primaryScore,
          opponentScore: context.currentLeader.opponentScore
        }
      });
    }
  }
};
