import type { PoolClient } from 'pg';

export type DisplayAdRecord = {
  id: number;
  title: string;
  body: string | null;
  footer: string | null;
  imageUrl: string | null;
  accentColor: string | null;
  activeFlg: boolean;
  sortOrder: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type DisplayAdSettingsRecord = {
  adsEnabled: boolean;
  frequencySeconds: number;
  durationSeconds: number;
  shrinkPercent: number;
  updatedAt: string | null;
};

export type SaveDisplayAdInput = {
  title: string;
  body?: string | null;
  footer?: string | null;
  imageUrl?: string | null;
  accentColor?: string | null;
  activeFlg: boolean;
  sortOrder: number;
};

export type SaveDisplayAdSettingsInput = {
  adsEnabled: boolean;
  frequencySeconds: number;
  durationSeconds: number;
  shrinkPercent: number;
};

const normalizeNullableText = (value: string | null | undefined): string | null => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
};

const mapDisplayAdRow = (row: Record<string, unknown>): DisplayAdRecord => ({
  id: Number(row.id ?? 0),
  title: String(row.title ?? ''),
  body: normalizeNullableText(typeof row.body === 'string' ? row.body : null),
  footer: normalizeNullableText(typeof row.footer === 'string' ? row.footer : null),
  imageUrl: normalizeNullableText(typeof row.image_url === 'string' ? row.image_url : null),
  accentColor: normalizeNullableText(typeof row.accent_color === 'string' ? row.accent_color : null),
  activeFlg: Boolean(row.active_flg ?? false),
  sortOrder: Number(row.sort_order ?? 0),
  createdAt: typeof row.created_at === 'string' ? row.created_at : null,
  updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null
});

const mapDisplayAdSettingsRow = (row: Record<string, unknown> | undefined): DisplayAdSettingsRecord => ({
  adsEnabled: Boolean(row?.ads_enabled_flg ?? false),
  frequencySeconds: Number(row?.frequency_seconds ?? 180),
  durationSeconds: Number(row?.duration_seconds ?? 30),
  shrinkPercent: Number(row?.shrink_percent ?? 80),
  updatedAt: typeof row?.updated_at === 'string' ? row.updated_at : null
});

export const ensureDisplayAdvertisingSupport = async (client: PoolClient): Promise<void> => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS football_pool.display_ad_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      ads_enabled_flg BOOLEAN NOT NULL DEFAULT FALSE,
      frequency_seconds INTEGER NOT NULL DEFAULT 180 CHECK (frequency_seconds BETWEEN 15 AND 3600),
      duration_seconds INTEGER NOT NULL DEFAULT 30 CHECK (duration_seconds BETWEEN 5 AND 600),
      shrink_percent INTEGER NOT NULL DEFAULT 80 CHECK (shrink_percent BETWEEN 50 AND 95),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

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
  `);

  await client.query(`
    INSERT INTO football_pool.display_ad_settings (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `);
};

export const getDisplayAdSettings = async (client: PoolClient): Promise<DisplayAdSettingsRecord> => {
  await ensureDisplayAdvertisingSupport(client);

  const result = await client.query(
    `SELECT ads_enabled_flg,
            frequency_seconds,
            duration_seconds,
            shrink_percent,
            updated_at
     FROM football_pool.display_ad_settings
     WHERE id = 1`
  );

  return mapDisplayAdSettingsRow(result.rows[0]);
};

export const saveDisplayAdSettings = async (
  client: PoolClient,
  input: SaveDisplayAdSettingsInput
): Promise<DisplayAdSettingsRecord> => {
  await ensureDisplayAdvertisingSupport(client);

  const result = await client.query(
    `UPDATE football_pool.display_ad_settings
     SET ads_enabled_flg = $1,
         frequency_seconds = $2,
         duration_seconds = $3,
         shrink_percent = $4,
         updated_at = NOW()
     WHERE id = 1
     RETURNING ads_enabled_flg,
               frequency_seconds,
               duration_seconds,
               shrink_percent,
               updated_at`,
    [input.adsEnabled, input.frequencySeconds, input.durationSeconds, input.shrinkPercent]
  );

  return mapDisplayAdSettingsRow(result.rows[0]);
};

export const listDisplayAds = async (
  client: PoolClient,
  options?: { includeInactive?: boolean }
): Promise<DisplayAdRecord[]> => {
  await ensureDisplayAdvertisingSupport(client);

  const includeInactive = Boolean(options?.includeInactive);
  const result = await client.query(
    `SELECT id,
            title,
            body,
            footer,
            image_url,
            accent_color,
            active_flg,
            sort_order,
            created_at,
            updated_at
     FROM football_pool.display_ad
     WHERE $1::boolean = TRUE OR active_flg = TRUE
     ORDER BY sort_order ASC, id ASC`,
    [includeInactive]
  );

  return result.rows.map((row) => mapDisplayAdRow(row));
};

export const createDisplayAd = async (client: PoolClient, input: SaveDisplayAdInput): Promise<DisplayAdRecord> => {
  await ensureDisplayAdvertisingSupport(client);

  const result = await client.query(
    `INSERT INTO football_pool.display_ad (
       title,
       body,
       footer,
       image_url,
       accent_color,
       active_flg,
       sort_order,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     RETURNING id,
               title,
               body,
               footer,
               image_url,
               accent_color,
               active_flg,
               sort_order,
               created_at,
               updated_at`,
    [
      input.title.trim(),
      normalizeNullableText(input.body),
      normalizeNullableText(input.footer),
      normalizeNullableText(input.imageUrl),
      normalizeNullableText(input.accentColor),
      input.activeFlg,
      input.sortOrder
    ]
  );

  return mapDisplayAdRow(result.rows[0]);
};

export const updateDisplayAd = async (
  client: PoolClient,
  adId: number,
  input: SaveDisplayAdInput
): Promise<DisplayAdRecord | null> => {
  await ensureDisplayAdvertisingSupport(client);

  const result = await client.query(
    `UPDATE football_pool.display_ad
     SET title = $2,
         body = $3,
         footer = $4,
         image_url = $5,
         accent_color = $6,
         active_flg = $7,
         sort_order = $8,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id,
               title,
               body,
               footer,
               image_url,
               accent_color,
               active_flg,
               sort_order,
               created_at,
               updated_at`,
    [
      adId,
      input.title.trim(),
      normalizeNullableText(input.body),
      normalizeNullableText(input.footer),
      normalizeNullableText(input.imageUrl),
      normalizeNullableText(input.accentColor),
      input.activeFlg,
      input.sortOrder
    ]
  );

  return result.rows[0] ? mapDisplayAdRow(result.rows[0]) : null;
};

export const deleteDisplayAd = async (client: PoolClient, adId: number): Promise<boolean> => {
  await ensureDisplayAdvertisingSupport(client);

  const result = await client.query(
    `DELETE FROM football_pool.display_ad
     WHERE id = $1`,
    [adId]
  );

  return (result.rowCount ?? 0) > 0;
};

export const loadDisplayAdvertising = async (
  client: PoolClient,
  options?: { includeInactive?: boolean }
): Promise<{ settings: DisplayAdSettingsRecord; ads: DisplayAdRecord[] }> => {
  const [settings, ads] = await Promise.all([
    getDisplayAdSettings(client),
    listDisplayAds(client, options)
  ]);

  return { settings, ads };
};
