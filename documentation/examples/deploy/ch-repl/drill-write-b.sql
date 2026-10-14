INSERT INTO analytics.traffic_events (ts, client_ip, host, uri, status) VALUES (now(), '10.255.255.3', 'node1-down-drill', '/probe-b', 200);
SELECT 'WROTE_B', count() FROM analytics.traffic_events WHERE client_ip = '10.255.255.3' FORMAT TSV;
