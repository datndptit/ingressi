-- P3: atomic name swap (source tables keep their data as *_local_backup until verified/dropped).
RENAME TABLE analytics.traffic_events TO analytics.traffic_events_local_backup,
             analytics.traffic_events_repl_stage TO analytics.traffic_events;
RENAME TABLE analytics.waf_events TO analytics.waf_events_local_backup,
             analytics.waf_events_repl_stage TO analytics.waf_events;
