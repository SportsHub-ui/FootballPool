import type { PoolClient } from 'pg';

export const notificationTemplateScopeValues = ['participant', 'pool_contact'] as const;
export type NotificationTemplateScope = (typeof notificationTemplateScopeValues)[number];

export const notificationTemplateKindValues = ['quarter_win', 'game_total', 'lead_warning'] as const;
export type NotificationTemplateKind = (typeof notificationTemplateKindValues)[number];

export const notificationMarkupFormatValues = ['plain_text', 'markdown'] as const;
export type NotificationMarkupFormat = (typeof notificationMarkupFormatValues)[number];

export type NotificationTemplateRecord = {
  recipientScope: NotificationTemplateScope;
  notificationKind: NotificationTemplateKind;
  subjectTemplate: string;
  bodyTemplate: string;
  markupFormat: NotificationMarkupFormat;
};

type NotificationTemplateRow = {
  recipient_scope: NotificationTemplateScope;
  notification_kind: NotificationTemplateKind;
  subject_template: string;
  body_template: string;
  markup_format: NotificationMarkupFormat | null;
};

export const DEFAULT_NOTIFICATION_TEMPLATES: Record<
  NotificationTemplateScope,
  Record<NotificationTemplateKind, Omit<NotificationTemplateRecord, 'recipientScope' | 'notificationKind'>>
> = {
  participant: {
    quarter_win: {
      subjectTemplate: 'You won Q{{quarter}} in {{poolName}}',
      bodyTemplate: [
        'Hi {{recipientName}},',
        '',
        'Your square #{{squareNum}} won quarter {{quarter}} in {{poolName}}.',
        '{{scoreLine}}',
        'Quarter payout: {{payout}}'
      ].join('\n'),
      markupFormat: 'plain_text'
    },
    game_total: {
      subjectTemplate: 'Final winnings for {{poolName}}',
      bodyTemplate: [
        'Hi {{recipientName}},',
        '',
        'The game in {{poolName}} has ended.',
        'Your total winnings: {{totalWon}}',
        '',
        '{{winningsBreakdown}}'
      ].join('\n'),
      markupFormat: 'plain_text'
    },
    lead_warning: {
      subjectTemplate: 'Your square is currently leading in {{poolName}}',
      bodyTemplate: [
        'Hi {{recipientName}},',
        '',
        'Square #{{squareNum}} would win quarter {{quarter}} in {{poolName}} if it ended right now.',
        'Current score: {{scoreLine}}'
      ].join('\n'),
      markupFormat: 'plain_text'
    }
  },
  pool_contact: {
    quarter_win: {
      subjectTemplate: 'Q{{quarter}} winner for {{poolName}}',
      bodyTemplate: [
        'Hi {{recipientName}},',
        '',
        '{{winnerName}} won quarter {{quarter}} in {{poolName}}.',
        'Winning square: #{{squareNum}}',
        '{{scoreLine}}',
        'Quarter payout: {{payout}}'
      ].join('\n'),
      markupFormat: 'plain_text'
    },
    game_total: {
      subjectTemplate: 'Game final summary for {{poolName}}',
      bodyTemplate: [
        'Hi {{recipientName}},',
        '',
        'The {{poolName}} game has ended. Final winnings summary:',
        '',
        '{{winningsBreakdown}}'
      ].join('\n'),
      markupFormat: 'plain_text'
    },
    lead_warning: {
      subjectTemplate: 'Live square leader for {{poolName}}',
      bodyTemplate: [
        'Hi {{recipientName}},',
        '',
        '{{leaderName}} on square #{{squareNum}} would win quarter {{quarter}} in {{poolName}} if the quarter ended now.',
        'Current score: {{scoreLine}}'
      ].join('\n'),
      markupFormat: 'plain_text'
    }
  }
};

export const availableNotificationVariables: Record<NotificationTemplateKind, string[]> = {
  quarter_win: [
    'recipientName',
    'winnerName',
    'poolName',
    'primaryTeamName',
    'opponentName',
    'scoreLine',
    'quarter',
    'squareNum',
    'payout'
  ],
  game_total: ['recipientName', 'winnerName', 'poolName', 'totalWon', 'winningsBreakdown'],
  lead_warning: [
    'recipientName',
    'leaderName',
    'poolName',
    'primaryTeamName',
    'opponentName',
    'scoreLine',
    'quarter',
    'squareNum'
  ]
};

const buildTemplateKey = (scope: NotificationTemplateScope, kind: NotificationTemplateKind): string => `${scope}:${kind}`;

const toTemplateRecord = (row: NotificationTemplateRow): NotificationTemplateRecord => ({
  recipientScope: row.recipient_scope,
  notificationKind: row.notification_kind,
  subjectTemplate: row.subject_template,
  bodyTemplate: row.body_template,
  markupFormat: row.markup_format === 'markdown' ? 'markdown' : 'plain_text'
});

const createDefaultTemplateRecord = (
  recipientScope: NotificationTemplateScope,
  notificationKind: NotificationTemplateKind
): NotificationTemplateRecord => ({
  recipientScope,
  notificationKind,
  ...DEFAULT_NOTIFICATION_TEMPLATES[recipientScope][notificationKind]
});

export const listNotificationTemplates = async (client: PoolClient): Promise<NotificationTemplateRecord[]> => {
  const result = await client.query<NotificationTemplateRow>(
    `SELECT recipient_scope,
            notification_kind,
            subject_template,
            body_template,
            markup_format
     FROM football_pool.notification_template`
  );

  const templateMap = new Map<string, NotificationTemplateRecord>();

  for (const row of result.rows) {
    const record = toTemplateRecord(row);
    templateMap.set(buildTemplateKey(record.recipientScope, record.notificationKind), record);
  }

  const records: NotificationTemplateRecord[] = [];

  for (const scope of notificationTemplateScopeValues) {
    for (const kind of notificationTemplateKindValues) {
      records.push(templateMap.get(buildTemplateKey(scope, kind)) ?? createDefaultTemplateRecord(scope, kind));
    }
  }

  return records;
};

export const getNotificationTemplateMap = async (
  client: PoolClient
): Promise<Map<string, NotificationTemplateRecord>> => {
  const templates = await listNotificationTemplates(client);
  return new Map(templates.map((template) => [buildTemplateKey(template.recipientScope, template.notificationKind), template]));
};

export const saveNotificationTemplate = async (
  client: PoolClient,
  recipientScope: NotificationTemplateScope,
  notificationKind: NotificationTemplateKind,
  input: {
    subjectTemplate: string;
    bodyTemplate: string;
    markupFormat: NotificationMarkupFormat;
  }
): Promise<NotificationTemplateRecord> => {
  const result = await client.query<NotificationTemplateRow>(
    `INSERT INTO football_pool.notification_template (
       recipient_scope,
       notification_kind,
       subject_template,
       body_template,
       markup_format,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (recipient_scope, notification_kind)
     DO UPDATE SET
       subject_template = EXCLUDED.subject_template,
       body_template = EXCLUDED.body_template,
       markup_format = EXCLUDED.markup_format,
       updated_at = NOW()
     RETURNING recipient_scope,
               notification_kind,
               subject_template,
               body_template,
               markup_format`,
    [recipientScope, notificationKind, input.subjectTemplate, input.bodyTemplate, input.markupFormat]
  );

  return toTemplateRecord(result.rows[0]);
};

const normalizeTemplateValue = (value: unknown): string => {
  if (value == null) {
    return '';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeTemplateValue(entry)).filter(Boolean).join(', ');
  }

  return String(value);
};

export const renderTemplateString = (template: string, variables: Record<string, unknown>): string =>
  template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, variableName: string) => normalizeTemplateValue(variables[variableName]));

export const renderNotificationTemplate = (args: {
  templateScope: NotificationTemplateScope;
  notificationKind: NotificationTemplateKind;
  variables: Record<string, unknown>;
  templateMap?: Map<string, NotificationTemplateRecord>;
}): {
  subject: string;
  body: string;
  markupFormat: NotificationMarkupFormat;
  template: NotificationTemplateRecord;
} => {
  const template =
    args.templateMap?.get(buildTemplateKey(args.templateScope, args.notificationKind)) ??
    createDefaultTemplateRecord(args.templateScope, args.notificationKind);

  return {
    subject: renderTemplateString(template.subjectTemplate, args.variables).trim(),
    body: renderTemplateString(template.bodyTemplate, args.variables).trim(),
    markupFormat: template.markupFormat,
    template
  };
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderInlineMarkdown = (value: string): string => {
  let output = escapeHtml(value);
  output = output.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  output = output.replace(/\*(.+?)\*/g, '<em>$1</em>');
  output = output.replace(/`(.+?)`/g, '<code>$1</code>');
  return output;
};

export const renderMarkupToHtml = (text: string, markupFormat: NotificationMarkupFormat): string => {
  if (markupFormat !== 'markdown') {
    return `<pre style="white-space: pre-wrap; font-family: Arial, sans-serif; margin: 0;">${escapeHtml(text)}</pre>`;
  }

  const lines = text.split(/\r?\n/);
  const htmlParts: string[] = [];
  const listItems: string[] = [];

  const flushList = (): void => {
    if (listItems.length === 0) {
      return;
    }

    htmlParts.push(`<ul>${listItems.join('')}</ul>`);
    listItems.length = 0;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      listItems.push(`<li>${renderInlineMarkdown(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }

    flushList();

    if (trimmed.startsWith('### ')) {
      htmlParts.push(`<h3>${renderInlineMarkdown(trimmed.slice(4))}</h3>`);
      continue;
    }

    if (trimmed.startsWith('## ')) {
      htmlParts.push(`<h2>${renderInlineMarkdown(trimmed.slice(3))}</h2>`);
      continue;
    }

    if (trimmed.startsWith('# ')) {
      htmlParts.push(`<h1>${renderInlineMarkdown(trimmed.slice(2))}</h1>`);
      continue;
    }

    htmlParts.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
  }

  flushList();

  return htmlParts.join('\n');
};
