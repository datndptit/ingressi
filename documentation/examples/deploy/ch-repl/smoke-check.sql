SELECT 'SEEN_ON_N2', count() FROM analytics.traffic_events WHERE client_ip = '10.255.255.1' FORMAT TSV;
SELECT 'TOTAL_N2', count() FROM analytics.traffic_events FORMAT TSV;
