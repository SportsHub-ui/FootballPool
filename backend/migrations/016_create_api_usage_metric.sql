BEGIN;

CREATE TABLE IF NOT EXISTS football_pool.api_usage_metric (
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
);

CREATE INDEX IF NOT EXISTS idx_api_usage_metric_bucket_start
    ON football_pool.api_usage_metric (bucket_start DESC);

CREATE INDEX IF NOT EXISTS idx_api_usage_metric_type_provider
    ON football_pool.api_usage_metric (metric_type, provider, bucket_start DESC);

COMMIT;
