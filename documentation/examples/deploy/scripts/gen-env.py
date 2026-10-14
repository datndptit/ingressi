#!/usr/bin/env python3
"""Sinh .env cho 1 node Ingressi (bộ mẫu deploy).

Usage:
  python3 gen-env.py <HOSTNAME> <BASE_URL> [--keeper] [--out .env]

- Ghi file .env (chmod 600), KHÔNG ghi đè file đã tồn tại.
- --keeper: thêm docker-compose.keeper.yml vào COMPOSE_FILE/COMPOSE_EXTRA_FILES
  (dùng cho node chạy ClickHouse Keeper).
- Secret được sinh sẵn; các giá trị cần điền tay để dạng CHANGEME (GEOIPUPDATE_*).
"""
import argparse
import secrets
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("hostname")
ap.add_argument("base_url")
ap.add_argument("--keeper", action="store_true")
ap.add_argument("--out", default=".env")
a = ap.parse_args()

compose_file = ("docker-compose.yml:docker-compose.argus.yml"
                ":docker-compose.crowdsec.yml:docker-compose.rootless.yml")
extra_files = ("/compose/docker-compose.argus.yml:/compose/docker-compose.crowdsec.yml"
               ":/compose/docker-compose.rootless.yml")
if a.keeper:
    compose_file += ":docker-compose.keeper.yml"
    extra_files += ":/compose/docker-compose.keeper.yml"

env = {
    "COMPOSE_PROJECT_NAME": "ingressi",
    "COMPOSE_FILE": compose_file,
    "COMPOSE_EXTRA_FILES": extra_files,
    "COMPOSE_PROFILES": "clickhouse,geoipupdate",
    "SESSION_SECRET": secrets.token_hex(32),
    "ADMIN_USERNAME": "admin",
    "ADMIN_PASSWORD": "Adm9#" + secrets.token_hex(24),
    "BASE_URL": a.base_url,
    "HOSTNAME": a.hostname,
    "INSTANCE_SYNC_ALLOW_HTTP": "true",
    "PUID": "1001",
    "PGID": "1001",
    "CADDY_GID": "1001",
    "ARGUS_SOCKET_VOLUME": "ingressi-argus-run",
    "ARGUS_SOCKET": "/run/argus/argus.sock",
    "ARGUS_TIMEOUT_MS": "50",
    "CROWDSEC_API_KEY": secrets.token_hex(32),
    "CROWDSEC_POSTGRES_PASSWORD": secrets.token_hex(32),
    "CLICKHOUSE_PASSWORD": secrets.token_hex(24),
    "CLICKHOUSE_URL": "http://clickhouse:8123",
    "CLICKHOUSE_USER": "ingressi",
    "CLICKHOUSE_DB": "analytics",
    "CLICKHOUSE_RETENTION_DAYS": "30",
    "AUTH_ALLOW_SELF_REGISTRATION": "false",
    "AUTH_ALLOW_OAUTH_REGISTRATION": "false",
    "GEOIPUPDATE_ACCOUNT_ID": "CHANGEME",
    "GEOIPUPDATE_LICENSE_KEY": "CHANGEME",
    "CH_IMAGE": "clickhouse/clickhouse-server:26.9.17.8-alpine",
}

p = Path(a.out)
assert not p.exists(), f"{p} đã tồn tại — không ghi đè"
with p.open("x") as f:
    f.write("".join(f"{k}={v}\n" for k, v in env.items()))
p.chmod(0o600)
print(f"Đã tạo {p} ({len(env)} khoá); không in secrets")
