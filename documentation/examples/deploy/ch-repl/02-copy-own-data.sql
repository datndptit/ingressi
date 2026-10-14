-- P3: each node copies ITS OWN local data into the local replica of the staged table;
-- ClickHouse replication then merges both datasets (union) onto both replicas.
INSERT INTO analytics.traffic_events_repl_stage SELECT * FROM analytics.traffic_events;
INSERT INTO analytics.waf_events_repl_stage SELECT * FROM analytics.waf_events;
