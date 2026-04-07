import type { Request } from 'express';
import { db } from '../config/db';

export type ApiUsageMetricType = 'http_request' | 'external_api';

export interface ApiUsageRecordInput {
  metricType: ApiUsageMetricType;
  provider?: string;
  routeKey: string;
  method?: string;
  statusCode?: number | null;
  durationMs?: number;
  occurredAt?: Date;
  count?: number;
}

type AggregatedUsageMetric = {
  bucketStart: Date;
  metricType: ApiUsageMetricType;
  provider: string;
  routeKey: string;
  method: string;
  statusCode: number;
  requestCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
  lastSeenAt: Date;
};

const aggregatedMetrics = new Map<string, AggregatedUsageMetric>();
let flushTimer: NodeJS.Timeout | null = null;
let flushInFlight: Promise<void> | null = null;

const FLUSH_INTERVAL_MS = 30_000;
const TOKEN_SEGMENT_PATTERN = /\/[A-Za-z0-9_-]{16,}(?=\/|$)/g;
const UUID_SEGMENT_PATTERN = /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi;
const NUMERIC_SEGMENT_PATTERN = /\/\d+(?=\/|$)/g;

const getBucketStart = (occurredAt: Date): Date => {
  const bucket = new Date(occurredAt);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket;
};

const sanitizeRouteKey = (value: string): string => {
  if (!value) {
    return '/unknown';
  }

  return value
    .split('?')[0]
    .replace(UUID_SEGMENT_PATTERN, '/:uuid')
    .replace(NUMERIC_SEGMENT_PATTERN, '/:id')
    .replace(TOKEN_SEGMENT_PATTERN, '/:token');
};

const buildMetricKey = (metric: AggregatedUsageMetric): string => [
  metric.bucketStart.toISOString(),
  metric.metricType,
  metric.provider,
  metric.routeKey,
  metric.method,
  metric.statusCode
].join('|');

const ensureFlushTimer = (): void => {
  if (flushTimer) {
    return;
  }

  flushTimer = setInterval(() => {
    void flushApiUsageMetricsNow();
  }, FLUSH_INTERVAL_MS);

  flushTimer.unref?.();
};

const ensureApiUsageMetricSupport = async () => {
  await db.query(
    `CREATE TABLE IF NOT EXISTS football_pool.api_usage_metric (
       id SERIAL PRIMARY KEY,
       bucket_start TIMESTAMP NOT NULL,
       metric_type VARCHAR(32) NOT NULL,
       provider VARCHAR(64) NOT NULL DEFAULT 'app',
       route_key VARCHAR(255) NOT NULL,
       method VARCHAR(16) NOT NULL DEFAULT '',
       status_code INTEGER NOT NULL DEFAULT 0,
       request_count INTEGER NOT NULL DEFAULT 0,
       total_duration_ms BIGINT NOT NULL DEFAULT 0,
       max_duration_ms INTEGER NOT NULL DEFAULT 0,
       last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
       created_at TIMESTAMP NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
       CONSTRAINT uq_api_usage_metric_bucket
         UNIQUE (bucket_start, metric_type, provider, route_key, method, status_code)
     )`
  );

  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_api_usage_metric_bucket_start
       ON football_pool.api_usage_metric (bucket_start DESC)`
  );

  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_api_usage_metric_type_provider
       ON football_pool.api_usage_metric (metric_type, provider, bucket_start DESC)`
  );
};

export const getRequestRouteKey = (req: Request): string => {
  const routePath =
    typeof req.route?.path === 'string'
      ? req.route.path
      : Array.isArray(req.route?.path)
        ? req.route.path.join('|')
        : req.path;

  return sanitizeRouteKey(`${req.baseUrl ?? ''}${routePath}` || req.originalUrl || req.path || '/unknown');
};

export const recordApiUsage = (input: ApiUsageRecordInput): void => {
  const occurredAt = input.occurredAt ?? new Date();
  const metric: AggregatedUsageMetric = {
    bucketStart: getBucketStart(occurredAt),
    metricType: input.metricType,
    provider: input.provider ?? 'app',
    routeKey: sanitizeRouteKey(input.routeKey),
    method: (input.method ?? '').toUpperCase(),
    statusCode: Number(input.statusCode ?? 0),
    requestCount: Math.max(1, Number(input.count ?? 1)),
    totalDurationMs: Math.max(0, Math.round(Number(input.durationMs ?? 0))),
    maxDurationMs: Math.max(0, Math.round(Number(input.durationMs ?? 0))),
    lastSeenAt: occurredAt
  };

  const key = buildMetricKey(metric);
  const existing = aggregatedMetrics.get(key);

  if (existing) {
    existing.requestCount += metric.requestCount;
    existing.totalDurationMs += metric.totalDurationMs;
    existing.maxDurationMs = Math.max(existing.maxDurationMs, metric.maxDurationMs);
    existing.lastSeenAt = metric.lastSeenAt;
  } else {
    aggregatedMetrics.set(key, metric);
  }

  ensureFlushTimer();
};

export const flushApiUsageMetricsNow = async (): Promise<void> => {
  if (flushInFlight) {
    await flushInFlight;
    return;
  }

  if (aggregatedMetrics.size === 0) {
    return;
  }

  const pending = Array.from(aggregatedMetrics.values());
  aggregatedMetrics.clear();

  flushInFlight = (async () => {
    await ensureApiUsageMetricSupport();
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      for (const metric of pending) {
        await client.query(
          `INSERT INTO football_pool.api_usage_metric (
             bucket_start,
             metric_type,
             provider,
             route_key,
             method,
             status_code,
             request_count,
             total_duration_ms,
             max_duration_ms,
             last_seen_at,
             created_at,
             updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
           ON CONFLICT (bucket_start, metric_type, provider, route_key, method, status_code)
           DO UPDATE SET
             request_count = football_pool.api_usage_metric.request_count + EXCLUDED.request_count,
             total_duration_ms = football_pool.api_usage_metric.total_duration_ms + EXCLUDED.total_duration_ms,
             max_duration_ms = GREATEST(football_pool.api_usage_metric.max_duration_ms, EXCLUDED.max_duration_ms),
             last_seen_at = GREATEST(football_pool.api_usage_metric.last_seen_at, EXCLUDED.last_seen_at),
             updated_at = NOW()`,
          [
            metric.bucketStart.toISOString(),
            metric.metricType,
            metric.provider,
            metric.routeKey,
            metric.method,
            metric.statusCode,
            metric.requestCount,
            metric.totalDurationMs,
            metric.maxDurationMs,
            metric.lastSeenAt.toISOString()
          ]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      for (const metric of pending) {
        const key = buildMetricKey(metric);
        const existing = aggregatedMetrics.get(key);
        if (existing) {
          existing.requestCount += metric.requestCount;
          existing.totalDurationMs += metric.totalDurationMs;
          existing.maxDurationMs = Math.max(existing.maxDurationMs, metric.maxDurationMs);
          existing.lastSeenAt = metric.lastSeenAt > existing.lastSeenAt ? metric.lastSeenAt : existing.lastSeenAt;
        } else {
          aggregatedMetrics.set(key, metric);
        }
      }
      throw error;
    } finally {
      client.release();
      flushInFlight = null;
    }
  })();

  await flushInFlight;
};

export const getApiUsageDashboard = async (options?: { hours?: number; limit?: number }) => {
  const hours = Math.max(1, Math.min(24 * 30, Number(options?.hours ?? 24)));
  const limit = Math.max(1, Math.min(100, Number(options?.limit ?? 15)));

  await ensureApiUsageMetricSupport();
  await flushApiUsageMetricsNow();

  const [summaryResult, routesResult, hourlyResult, externalResult] = await Promise.all([
    db.query(
      `SELECT
          COALESCE(SUM(request_count), 0)::bigint AS total_requests,
          COALESCE(SUM(request_count) FILTER (WHERE metric_type = 'http_request'), 0)::bigint AS app_requests,
          COALESCE(SUM(request_count) FILTER (WHERE metric_type = 'external_api'), 0)::bigint AS external_requests,
          COALESCE(SUM(request_count) FILTER (WHERE status_code >= 400), 0)::bigint AS error_requests,
          COALESCE(SUM(total_duration_ms), 0)::bigint AS total_duration_ms,
          COALESCE(MAX(last_seen_at), NOW()) AS last_seen_at
       FROM football_pool.api_usage_metric
       WHERE bucket_start >= NOW() - ($1::int || ' hours')::interval`,
      [hours]
    ),
    db.query(
      `SELECT
          route_key,
          method,
          SUM(request_count)::bigint AS request_count,
          SUM(total_duration_ms)::bigint AS total_duration_ms,
          MAX(max_duration_ms)::int AS max_duration_ms,
          SUM(CASE WHEN status_code >= 400 THEN request_count ELSE 0 END)::bigint AS error_count
       FROM football_pool.api_usage_metric
       WHERE bucket_start >= NOW() - ($1::int || ' hours')::interval
         AND metric_type = 'http_request'
       GROUP BY route_key, method
       ORDER BY request_count DESC, route_key ASC
       LIMIT $2`,
      [hours, limit]
    ),
    db.query(
      `SELECT
          date_trunc('hour', bucket_start) AS bucket_start,
          SUM(request_count)::bigint AS request_count,
          SUM(CASE WHEN metric_type = 'external_api' THEN request_count ELSE 0 END)::bigint AS external_request_count
       FROM football_pool.api_usage_metric
       WHERE bucket_start >= NOW() - ($1::int || ' hours')::interval
       GROUP BY date_trunc('hour', bucket_start)
       ORDER BY bucket_start ASC`,
      [hours]
    ),
    db.query(
      `SELECT
          provider,
          route_key,
          SUM(request_count)::bigint AS request_count,
          MAX(status_code)::int AS last_status_code
       FROM football_pool.api_usage_metric
       WHERE bucket_start >= NOW() - ($1::int || ' hours')::interval
         AND metric_type = 'external_api'
       GROUP BY provider, route_key
       ORDER BY request_count DESC, provider ASC, route_key ASC
       LIMIT $2`,
      [hours, limit]
    )
  ]);

  const summary = summaryResult.rows[0] ?? {};
  const totalRequests = Number(summary.total_requests ?? 0);
  const averageDurationMs = totalRequests > 0
    ? Number(summary.total_duration_ms ?? 0) / totalRequests
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    windowHours: hours,
    summary: {
      totalRequests,
      appRequests: Number(summary.app_requests ?? 0),
      externalRequests: Number(summary.external_requests ?? 0),
      errorRequests: Number(summary.error_requests ?? 0),
      averageDurationMs: Number(averageDurationMs.toFixed(2)),
      lastSeenAt: summary.last_seen_at ?? null
    },
    topRoutes: routesResult.rows.map((row) => ({
      routeKey: row.route_key,
      method: row.method,
      requestCount: Number(row.request_count ?? 0),
      averageDurationMs: Number(row.request_count ?? 0) > 0
        ? Number((Number(row.total_duration_ms ?? 0) / Number(row.request_count ?? 1)).toFixed(2))
        : 0,
      maxDurationMs: Number(row.max_duration_ms ?? 0),
      errorCount: Number(row.error_count ?? 0)
    })),
    hourlyTraffic: hourlyResult.rows.map((row) => ({
      bucketStart: row.bucket_start,
      requestCount: Number(row.request_count ?? 0),
      externalRequestCount: Number(row.external_request_count ?? 0)
    })),
    externalApis: externalResult.rows.map((row) => ({
      provider: row.provider,
      routeKey: row.route_key,
      requestCount: Number(row.request_count ?? 0),
      lastStatusCode: Number(row.last_status_code ?? 0)
    }))
  };
};

export const stopApiUsageTracking = async (): Promise<void> => {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }

  await flushApiUsageMetricsNow().catch(() => undefined);
};
