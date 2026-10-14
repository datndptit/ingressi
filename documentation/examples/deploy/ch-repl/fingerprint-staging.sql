SELECT 'traffic_events', count(), sumWithOverflow(cityHash64(tuple(*))), groupBitXor(cityHash64(tuple(*)))
FROM analytics.traffic_events_repl_stage
UNION ALL
SELECT 'waf_events', count(), sumWithOverflow(cityHash64(tuple(*))), groupBitXor(cityHash64(tuple(*)))
FROM analytics.waf_events_repl_stage
FORMAT TSV;
