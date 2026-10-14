SELECT 'SEEN_2', count() FROM analytics.traffic_events WHERE client_ip = '10.255.255.2' FORMAT TSV;
SELECT 'SEEN_3', count() FROM analytics.traffic_events WHERE client_ip = '10.255.255.3' FORMAT TSV;
