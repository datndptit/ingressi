INSERT INTO analytics.traffic_events (ts, client_ip, host, uri, status) VALUES (now(), '10.255.255.1', 'repl-test', '/replication-smoke', 200);
SELECT 'INSERTED_N1', count() FROM analytics.traffic_events WHERE client_ip = '10.255.255.1' FORMAT TSV;
