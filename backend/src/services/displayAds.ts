import type { PoolClient } from 'pg';

export type DisplayAdPlacement = 'sidebar' | 'banner';

export type DisplayAdRecord = {
  id: number;
  title: string;
  body: string | null;
  footer: string | null;
  imageUrl: string | null;
  accentColor: string | null;
  activeFlg: boolean;
  sortOrder: number;
  placement: DisplayAdPlacement;
  organizationId: number | null;
  organizationName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type DisplayAdSettingsRecord = {
  adsEnabled: boolean;
  frequencySeconds: number;
  durationSeconds: number;
  shrinkPercent: number;
  sidebarCount: number;
  bannerCount: number;
  defaultBannerMessage: string | null;
  hideAdsForOrganization: boolean;
  organizationId: number | null;
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
  placement: DisplayAdPlacement;
  organizationId?: number | null;
};

export type SaveDisplayAdSettingsInput = {
  adsEnabled: boolean;
  frequencySeconds: number;
  durationSeconds: number;
  shrinkPercent: number;
  sidebarCount: number;
  bannerCount: number;
  defaultBannerMessage?: string | null;
  hideAdsForOrganization?: boolean;
};

const DEFAULT_SETTINGS: DisplayAdSettingsRecord = {
  adsEnabled: false,
  frequencySeconds: 180,
  durationSeconds: 30,
  shrinkPercent: 80,
  sidebarCount: 1,
  bannerCount: 1,
  defaultBannerMessage: null,
  hideAdsForOrganization: false,
  organizationId: null,
  updatedAt: null
};

const normalizeNullableText = (value: string | null | undefined): string | null => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
};

const normalizeOrganizationId = (value: number | null | undefined): number | null => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const resolvePlacement = (value: unknown): DisplayAdPlacement => (value === 'banner' ? 'banner' : 'sidebar');

const mapDisplayAdRow = (row: Record<string, unknown>): DisplayAdRecord => ({
  id: Number(row.id ?? 0),
  title: String(row.title ?? ''),
  body: normalizeNullableText(typeof row.body === 'string' ? row.body : null),
  footer: normalizeNullableText(typeof row.footer === 'string' ? row.footer : null),
  imageUrl: normalizeNullableText(typeof row.image_url === 'string' ? row.image_url : null),
  accentColor: normalizeNullableText(typeof row.accent_color === 'string' ? row.accent_color : null),
  activeFlg: Boolean(row.active_flg ?? false),
  sortOrder: Number(row.sort_order ?? 0),
  placement: resolvePlacement(row.placement),
  organizationId: normalizeOrganizationId(typeof row.organization_id === 'number' ? row.organization_id : Number(row.organization_id ?? 0)),
  organizationName: normalizeNullableText(typeof row.organization_name === 'string' ? row.organization_name : null),
  createdAt: typeof row.created_at === 'string' ? row.created_at : null,
  updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null
});

const mapDisplayAdSettingsRow = (
  row: Record<string, unknown> | undefined,
  fallback?: DisplayAdSettingsRecord,
  organizationId?: number | null
): DisplayAdSettingsRecord => ({
  adsEnabled: Boolean(row?.ads_enabled_flg ?? fallback?.adsEnabled ?? DEFAULT_SETTINGS.adsEnabled),
  frequencySeconds: Number(row?.frequency_seconds ?? fallback?.frequencySeconds ?? DEFAULT_SETTINGS.frequencySeconds),
  durationSeconds: Number(row?.duration_seconds ?? fallback?.durationSeconds ?? DEFAULT_SETTINGS.durationSeconds),
  shrinkPercent: Number(row?.shrink_percent ?? fallback?.shrinkPercent ?? DEFAULT_SETTINGS.shrinkPercent),
  sidebarCount: Number(row?.sidebar_count ?? fallback?.sidebarCount ?? DEFAULT_SETTINGS.sidebarCount),
  bannerCount: Number(row?.banner_count ?? fallback?.bannerCount ?? DEFAULT_SETTINGS.bannerCount),
  defaultBannerMessage: normalizeNullableText(
    typeof row?.default_banner_message === 'string'
      ? row.default_banner_message
      : fallback?.defaultBannerMessage ?? null
  ),
  hideAdsForOrganization: Boolean(row?.hide_ads_flg ?? fallback?.hideAdsForOrganization ?? DEFAULT_SETTINGS.hideAdsForOrganization),
  organizationId: normalizeOrganizationId(organizationId ?? fallback?.organizationId ?? null),
  updatedAt: typeof row?.updated_at === 'string' ? row.updated_at : fallback?.updatedAt ?? null
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

    ALTER TABLE football_pool.display_ad
      ADD COLUMN IF NOT EXISTS placement VARCHAR(16) NOT NULL DEFAULT 'sidebar',
      ADD COLUMN IF NOT EXISTS organization_id BIGINT NULL REFERENCES football_pool.organization(id) ON DELETE CASCADE;

    CREATE INDEX IF NOT EXISTS idx_display_ad_active_sort
      ON football_pool.display_ad (active_flg, sort_order, id);

    CREATE INDEX IF NOT EXISTS idx_display_ad_scope_sort
      ON football_pool.display_ad (organization_id, placement, sort_order, id);
  `);

  await client.query(`
    INSERT INTO football_pool.display_ad_settings (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `);

  await client.query(`
    UPDATE football_pool.display_ad_settings
    SET sidebar_count = COALESCE(sidebar_count, 1),
        banner_count = COALESCE(banner_count, 1)
    WHERE id = 1
  `);
};

export const getDisplayAdSettings = async (
  client: PoolClient,
  options?: { organizationId?: number | null }
): Promise<DisplayAdSettingsRecord> => {
  await ensureDisplayAdvertisingSupport(client);

  const organizationId = normalizeOrganizationId(options?.organizationId ?? null);
  const globalResult = await client.query(
    `SELECT ads_enabled_flg,
            frequency_seconds,
            duration_seconds,
            shrink_percent,
            sidebar_count,
            banner_count,
            default_banner_message,
            updated_at
     FROM football_pool.display_ad_settings
     WHERE id = 1`
  );

  const globalSettings = mapDisplayAdSettingsRow(globalResult.rows[0], DEFAULT_SETTINGS, null);

  if (organizationId == null) {
    return globalSettings;
  }

  const organizationResult = await client.query(
    `SELECT organization_id,
            ads_enabled_flg,
            hide_ads_flg,
            frequency_seconds,
            duration_seconds,
            shrink_percent,
            sidebar_count,
            banner_count,
            default_banner_message,
            updated_at
     FROM football_pool.organization_display_ad_settings
     WHERE organization_id = $1`,
    [organizationId]
  );

  return mapDisplayAdSettingsRow(organizationResult.rows[0], globalSettings, organizationId);
};

export const saveDisplayAdSettings = async (
  client: PoolClient,
  input: SaveDisplayAdSettingsInput,
  options?: { organizationId?: number | null }
): Promise<DisplayAdSettingsRecord> => {
  await ensureDisplayAdvertisingSupport(client);

  const organizationId = normalizeOrganizationId(options?.organizationId ?? null);
  const payload = [
    input.adsEnabled,
    input.frequencySeconds,
    input.durationSeconds,
    input.shrinkPercent,
    input.sidebarCount,
    input.bannerCount,
    normalizeNullableText(input.defaultBannerMessage),
    Boolean(input.hideAdsForOrganization ?? false)
  ];

  if (organizationId == null) {
    const result = await client.query(
      `UPDATE football_pool.display_ad_settings
       SET ads_enabled_flg = $1,
           frequency_seconds = $2,
           duration_seconds = $3,
           shrink_percent = $4,
           sidebar_count = $5,
           banner_count = $6,
           default_banner_message = $7,
           updated_at = NOW()
       WHERE id = 1
       RETURNING ads_enabled_flg,
                 frequency_seconds,
                 duration_seconds,
                 shrink_percent,
                 sidebar_count,
                 banner_count,
                 default_banner_message,
                 updated_at`,
      payload.slice(0, 7)
    );

    return mapDisplayAdSettingsRow(result.rows[0], DEFAULT_SETTINGS, null);
  }

  const result = await client.query(
    `INSERT INTO football_pool.organization_display_ad_settings (
       organization_id,
       ads_enabled_flg,
       frequency_seconds,
       duration_seconds,
       shrink_percent,
       sidebar_count,
       banner_count,
       default_banner_message,
       hide_ads_flg,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
     ON CONFLICT (organization_id)
     DO UPDATE SET ads_enabled_flg = EXCLUDED.ads_enabled_flg,
                   frequency_seconds = EXCLUDED.frequency_seconds,
                   duration_seconds = EXCLUDED.duration_seconds,
                   shrink_percent = EXCLUDED.shrink_percent,
                   sidebar_count = EXCLUDED.sidebar_count,
                   banner_count = EXCLUDED.banner_count,
                   default_banner_message = EXCLUDED.default_banner_message,
                   hide_ads_flg = EXCLUDED.hide_ads_flg,
                   updated_at = NOW()
     RETURNING organization_id,
               ads_enabled_flg,
               hide_ads_flg,
               frequency_seconds,
               duration_seconds,
               shrink_percent,
               sidebar_count,
               banner_count,
               default_banner_message,
               updated_at`,
    [organizationId, ...payload]
  );

  return mapDisplayAdSettingsRow(result.rows[0], DEFAULT_SETTINGS, organizationId);
};

export const listDisplayAds = async (
  client: PoolClient,
  options?: { includeInactive?: boolean; organizationId?: number | null; placement?: DisplayAdPlacement | null }
): Promise<DisplayAdRecord[]> => {
  await ensureDisplayAdvertisingSupport(client);

  const includeInactive = Boolean(options?.includeInactive);
  const organizationId = normalizeOrganizationId(options?.organizationId ?? null);
  const placement = options?.placement ?? null;

  const result = await client.query(
    `SELECT da.id,
            da.title,
            da.body,
            da.footer,
            da.image_url,
            da.accent_color,
            da.active_flg,
            da.sort_order,
            da.placement,
            da.organization_id,
            org.team_name AS organization_name,
            da.created_at,
            da.updated_at
     FROM football_pool.display_ad da
     LEFT JOIN football_pool.organization org ON org.id = da.organization_id
     WHERE ($1::boolean = TRUE OR da.active_flg = TRUE)
       AND (($2::bigint IS NULL AND da.organization_id IS NULL) OR da.organization_id = $2::bigint)
       AND ($3::text IS NULL OR da.placement = $3::text)
     ORDER BY da.sort_order ASC, da.id ASC`,
    [includeInactive, organizationId, placement]
  );

  return result.rows.map((row) => mapDisplayAdRow(row));
};

export const createDisplayAd = async (client: PoolClient, input: SaveDisplayAdInput): Promise<DisplayAdRecord> => {
  await ensureDisplayAdvertisingSupport(client);

  const organizationId = normalizeOrganizationId(input.organizationId ?? null);
  const result = await client.query(
    `INSERT INTO football_pool.display_ad (
       title,
       body,
       footer,
       image_url,
       accent_color,
       active_flg,
       sort_order,
       placement,
       organization_id,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
     RETURNING id,
               title,
               body,
               footer,
               image_url,
               accent_color,
               active_flg,
               sort_order,
               placement,
               organization_id,
               created_at,
               updated_at`,
    [
      input.title.trim(),
      normalizeNullableText(input.body),
      normalizeNullableText(input.footer),
      normalizeNullableText(input.imageUrl),
      normalizeNullableText(input.accentColor),
      input.activeFlg,
      input.sortOrder,
      resolvePlacement(input.placement),
      organizationId
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

  const organizationId = normalizeOrganizationId(input.organizationId ?? null);
  const result = await client.query(
    `UPDATE football_pool.display_ad
     SET title = $2,
         body = $3,
         footer = $4,
         image_url = $5,
         accent_color = $6,
         active_flg = $7,
         sort_order = $8,
         placement = $9,
         organization_id = $10,
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
               placement,
               organization_id,
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
      input.sortOrder,
      resolvePlacement(input.placement),
      organizationId
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
  options?: { includeInactive?: boolean; organizationId?: number | null }
): Promise<{ settings: DisplayAdSettingsRecord; ads: DisplayAdRecord[] }> => {
  const includeInactive = Boolean(options?.includeInactive);
  const organizationId = normalizeOrganizationId(options?.organizationId ?? null);
  const settings = await getDisplayAdSettings(client, { organizationId });

  if (includeInactive) {
    const ads = await listDisplayAds(client, { includeInactive, organizationId });
    return { settings, ads };
  }

  if (settings.hideAdsForOrganization) {
    return { settings, ads: [] };
  }

  if (organizationId != null) {
    const organizationAds = await listDisplayAds(client, { includeInactive: false, organizationId });
    if (organizationAds.length > 0) {
      return { settings, ads: organizationAds };
    }
  }

  const ads = await listDisplayAds(client, { includeInactive: false, organizationId: null });
  return { settings, ads };
};
