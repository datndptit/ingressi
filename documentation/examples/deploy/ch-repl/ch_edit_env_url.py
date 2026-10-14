#!/usr/bin/env python3
"""P3 step: rewrite CLICKHOUSE_URL in .env with the ch_* replica params (both nodes)."""
import pathlib, time

p = pathlib.Path('/home/dockerwaf/ingressi/.env')
t = p.read_text()
old_line = 'CLICKHOUSE_URL=http://clickhouse:8123'
new_line = ('CLICKHOUSE_URL=http://clickhouse:8123?ch_async_insert=1&ch_wait_for_async_insert=1'
            '&ch_insert_quorum=1&ch_insert_quorum_timeout=10000&request_timeout=20000')
lines = t.splitlines(keepends=True)
hits = sum(1 for l in lines if l.strip() == old_line)
if hits == 1:
    ts = time.strftime('%Y%m%d-%H%M%S')
    bak = p.parent / ('.env.bak-url-' + ts)
    bak.write_text(t)
    out = ''.join(new_line + '\n' if l.strip() == old_line else l for l in lines)
    p.write_text(out)
    print('URL_UPDATED backup=%s' % bak.name)
else:
    cur = [l.strip() for l in lines if l.startswith('CLICKHOUSE_URL=')]
    print('URL_EDIT_HITS=%d current=%s' % (hits, ' | '.join(cur)[:150]))
