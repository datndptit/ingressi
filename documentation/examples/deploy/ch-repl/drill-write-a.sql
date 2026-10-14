INSERT INTO analytics.traffic_events (ts, client_ip, host, uri, status) VALUES (now(), '10.255.255.2', 'keeper-drill', '/probe-a', 200);
SELECT 'WROTE_A', count() FROM analytics.traffic_events WHERE client_ip = '10.255.255.2' FORMAT TSV;
