#!/usr/bin/env python3
"""P1: pin ClickHouse image + swap interserver.xml mount -> replication.xml + add CH_IMAGE to .env.
Idempotence guard: if the old image/volume strings are gone, it aborts and says so.
No container restart here.
Post-split note (2026-10-15): the ClickHouse Keeper service lives in docker-compose.keeper.yml
(node2-only, loaded via COMPOSE_FILE/COMPOSE_EXTRA_FILES); this overlay no longer contains it."""
import pathlib, subprocess, sys, time

root = pathlib.Path('/home/dockerwaf/ingressi')
role = sys.argv[1] if len(sys.argv) > 1 else '?'
f = root / 'docker-compose.rootless.yml'
src = f.read_text()

img_old = 'image: clickhouse/clickhouse-server:latest-alpine'
img_new = 'image: ${CH_IMAGE:?Set CH_IMAGE to a pinned clickhouse image}'
vol_old = '      - ./deploy/clickhouse/interserver.xml:/etc/clickhouse-server/config.d/interserver.xml:ro'
vol_new = '      - ./deploy/clickhouse/replication.xml:/etc/clickhouse-server/config.d/ingressi-replication.xml:ro'

n_img = src.count(img_old)
n_vol = src.count(vol_old)
if n_vol != 1:
    raise SystemExit('ABORT VOL_COUNT=%d (expected 1) - inspect before rerun' % n_vol)
if n_img < 1:
    raise SystemExit('ABORT IMG_COUNT=%d (expected >=1) - already edited?' % n_img)

ts = time.strftime('%Y%m%d-%H%M%S')
bak = root / ('docker-compose.rootless.yml.bak-chrepl-' + ts)
bak.write_text(src)
out = src.replace(img_old, img_new).replace(vol_old, vol_new)
if not out.endswith('\n'):
    out += '\n'
f.write_text(out)
print('COMPOSE_OK role=%s images_pinned=%d volume_swapped=%d backup=%s' % (role, n_img, n_vol, bak.name))

env = root / '.env'
etext = env.read_text()
if 'CH_IMAGE=' in etext:
    print('ENV_CH_IMAGE_EXISTS')
else:
    envbak = root / ('.env.bak-chrepl-' + ts)
    envbak.write_text(etext)
    if not etext.endswith('\n'):
        etext += '\n'
    etext += '# CH replication (13/10/2026): pinned image /\nCH_IMAGE=clickhouse/clickhouse-server:26.9.17.8-alpine\n'
    env.write_text(etext)
    print('ENV_CH_IMAGE_ADDED backup=%s' % envbak.name)

r = subprocess.run(['docker', 'compose', 'config', '--quiet'], cwd=str(root), capture_output=True, text=True)
print('CONFIG_RC=%d stderr=%s' % (r.returncode, (r.stderr or '').strip()[:200]))
