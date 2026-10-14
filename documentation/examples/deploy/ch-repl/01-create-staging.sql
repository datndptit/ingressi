-- Run on BOTH VMs, with BOTH web containers stopped.
-- Canonical Keeper path namespace /ingressi/analytics/01/... (matches guide 5.2 / 13;
-- new nodes can join these paths directly).
-- The table names are exchanged later (RENAME), so the path carries the FINAL table name.
-- No IF NOT EXISTS on purpose: an existing staging table requires investigation.
CREATE TABLE analytics.traffic_events_repl_stage AS analytics.traffic_events
ENGINE = ReplicatedMergeTree('/ingressi/analytics/01/traffic_events', '{replica}')
PARTITION BY toYYYYMM(ts)
ORDER BY (host, ts)
SETTINGS index_granularity = 8192;

CREATE TABLE analytics.waf_events_repl_stage AS analytics.waf_events
ENGINE = ReplicatedMergeTree('/ingressi/analytics/01/waf_events', '{replica}')
PARTITION BY toYYYYMM(ts)
ORDER BY (host, ts)
SETTINGS index_granularity = 8192;

-- No TTL here on purpose: the union is verified without TTL interference;
-- Ingressi reapplies CLICKHOUSE_RETENTION_DAYS (ALTER ... MODIFY TTL) after cutover.
