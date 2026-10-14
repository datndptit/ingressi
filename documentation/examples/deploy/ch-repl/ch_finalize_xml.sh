#!/bin/bash
# P1: render deploy/clickhouse/replication.xml per node from the template.
# Usage: bash ch_finalize_xml.sh node1|node2
# NOTE (example kit): REPLICA/KEEPER/NODEIP mapping below is for the reference cluster - adapt it for your cluster.
# Reads the shared secret from /home/dockerwaf/ingressi-deploy/ch-repl/.interserver_pw (600).
set -eu
ROLE="$1"
D=/home/dockerwaf/ingressi-deploy/ch-repl
PWF=$D/.interserver_pw
XML=/home/dockerwaf/ingressi/deploy/clickhouse/replication.xml
case "$ROLE" in
  node1) REPLICA=waf-01; KEEPER=10.2.159.19; NODEIP=10.2.159.18 ;;
  node2) REPLICA=waf-02; KEEPER=clickhouse-keeper; NODEIP=10.2.159.19 ;;
  *) echo BAD_ROLE; exit 1 ;;
esac
[ -s "$PWF" ] || { echo PW_FILE_MISSING; exit 1; }
PW="$(cat "$PWF")"
sed -e "s/__CH_REPLICA__/$REPLICA/" -e "s|__CH_KEEPER_HOST__|$KEEPER|" -e "s/__CH_NODE_IP__/$NODEIP/" -e "s/__CH_INTERSERVER_PW__/$PW/" "$D/replication.xml.tmpl" > "$XML.tmp"
if grep -q '__CH_' "$XML.tmp"; then echo TEMPLATE_LEFTOVER; rm -f "$XML.tmp"; exit 1; fi
# MUST be world-readable (644): the CH server drops to the in-container
# clickhouse user (uid 101 -> host uid 165636 under the rootless mapping)
# before merging config.d; a 600 dockerwaf file => "Access to file denied".
chmod 644 "$XML.tmp"
# Write IN PLACE when the target exists: bind mounts hold the inode, and
# `mv` over a mounted file leaves the container reading the OLD inode.
if [ -f "$XML" ]; then cat "$XML.tmp" > "$XML"; rm -f "$XML.tmp"; else mv "$XML.tmp" "$XML"; fi
chmod 644 "$XML"
python3 - "$XML" <<'PY'
import sys, xml.etree.ElementTree as ET
r = ET.parse(sys.argv[1]).getroot()
rep = r.find('macros/replica').text
kh = r.find('zookeeper/node/host').text
ip = r.find('interserver_http_host').text
u = r.find('interserver_http_credentials/user').text
pwlen = len(r.find('interserver_http_credentials/password').text or '')
print('XML_OK replica=%s keeper=%s ip=%s user=%s pw_len=%d' % (rep, kh, ip, u, pwlen))
PY
