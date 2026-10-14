#!/usr/bin/env python3
"""P3 step: wait until the staged replicas hold the expected union counts on this node.
Usage: python3 ch_wait_stage.py <traffic_target> <waf_target> <timeout_s>"""
import subprocess, sys, time

def q(sql):
    r = subprocess.run(['docker', 'exec', 'ingressi-clickhouse', 'clickhouse-client', '--query', sql],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit('QFAIL %s :: %s' % (sql, r.stderr.strip()[:200]))
    return r.stdout.strip()

traffic_t = int(sys.argv[1]); waf_t = int(sys.argv[2]); timeout = int(sys.argv[3])
deadline = time.time() + timeout
while True:
    n = int(q('SELECT count() FROM analytics.traffic_events_repl_stage'))
    w = int(q('SELECT count() FROM analytics.waf_events_repl_stage'))
    queue = q("SELECT count() FROM system.replication_queue")
    print('traffic_stage=%d waf_stage=%d replication_queue=%s' % (n, w, queue), flush=True)
    if n >= traffic_t and w >= waf_t:
        print('SYNC_REACHED')
        break
    if time.time() > deadline:
        print('SYNC_TIMEOUT traffic_stage=%d waf_stage=%d' % (n, w))
        break
    time.sleep(5)
