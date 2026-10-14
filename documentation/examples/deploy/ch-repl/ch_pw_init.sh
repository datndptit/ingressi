#!/bin/bash
# P1: create the shared interserver secret ON NODE1 ONLY (value never printed).
set -eu
D=/home/dockerwaf/ingressi-deploy/ch-repl
PWF=$D/.interserver_pw
umask 077
if [ -s "$PWF" ]; then
  echo PW_EXISTS_BYTES=$(wc -c < "$PWF")
else
  python3 -c "import secrets,sys; sys.stdout.write(secrets.token_hex(16))" > "$PWF"
  chmod 600 "$PWF"
  echo PW_CREATED_BYTES=$(wc -c < "$PWF")
fi
