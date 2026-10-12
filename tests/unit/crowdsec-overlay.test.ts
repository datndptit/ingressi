/**
 * The CrowdSec deployment files of this fork: docker-compose.crowdsec.yml,
 * docker/crowdsec/config.yaml.local, docker/crowdsec/acquis.d/caddy.yaml and
 * the L4 port manager's overlay retention (COMPOSE_EXTRA_FILES next to the
 * single COMPOSE_EXTRA_FILE older overlays use).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const overlay = () => readFileSync(resolve('docker-compose.crowdsec.yml'), 'utf8');
const manager = () => readFileSync(resolve('docker/l4-port-manager/entrypoint.sh'), 'utf8');
const configLocal = () => readFileSync(resolve('docker/crowdsec/config.yaml.local'), 'utf8');
const acquisition = () => readFileSync(resolve('docker/crowdsec/acquis.d/caddy.yaml'), 'utf8');

const requiredKey = '${CROWDSEC_API_KEY:?ERROR - CROWDSEC_API_KEY is required}';

describe('docker-compose.crowdsec.yml', () => {
  it('runs the pinned CrowdSec engine and PostgreSQL, reachable only on the compose network', () => {
    expect(overlay()).toContain('image: crowdsecurity/crowdsec:v1.8.1');
    expect(overlay()).toContain('image: postgres:17-alpine');
    // LAPI and the database are services of the app network; nothing is
    // published on the host.
    expect(overlay()).not.toMatch(/^\s*ports:/m);
  });

  it('registers the bouncer and shares the JSON access log', () => {
    expect(overlay()).toContain(`BOUNCER_KEY_ingressi: ${requiredKey}`);
    expect(overlay()).toContain(`CROWDSEC_API_KEY: ${requiredKey}`);
    expect(overlay()).toContain('COLLECTIONS: crowdsecurity/caddy');
    expect(overlay()).toContain('caddy-logs:/logs:ro');
    expect(overlay()).toContain('config.yaml.local:/etc/crowdsec/config.yaml.local:ro');
    expect(overlay()).toContain('acquis.d/caddy.yaml:/etc/crowdsec/acquis.d/caddy.yaml:ro');
    expect(acquisition()).toContain('/logs/access.log');
    expect(acquisition()).toContain('type: caddy');
  });

  it('pins caddy, web and the port manager to the images built from this fork', () => {
    expect(overlay()).toContain('image: ingressi-caddy-crowdsec:local');
    expect(overlay()).toContain('image: ingressi-web-crowdsec:local');
    expect(overlay()).toContain('image: ingressi-l4-port-manager-crowdsec:local');
  });

  it('keeps every overlay during L4 port-manager recreation', () => {
    expect(overlay()).toContain(
      'COMPOSE_EXTRA_FILES: ${COMPOSE_EXTRA_FILES:-/compose/docker-compose.crowdsec.yml}'
    );
    // The entrypoint reads the colon-separated list, still honours the single
    // legacy variable, and skips files that do not exist.
    expect(manager()).toContain('EXTRA_FILES="${COMPOSE_EXTRA_FILES:-}"');
    expect(manager()).toContain('if [ -n "$COMPOSE_EXTRA_FILE" ]; then');
    expect(manager()).toContain("tr ':' ' '");
    expect(manager()).toContain('-f $EXTRA_FILE');
    expect(manager()).toContain('EXTRA_FILES="$COMPOSE_EXTRA_FILE${EXTRA_FILES:+:$EXTRA_FILES}"');
  });

  it('configures PostgreSQL with the password from the environment', () => {
    expect(configLocal()).toContain('type: postgresql');
    expect(configLocal()).toContain('password: ${CROWDSEC_POSTGRES_PASSWORD}');
    expect(configLocal()).toContain('host: crowdsec-postgres');
    // Check the engine's own service block: setting POSTGRES_PASSWORD on the
    // database alone does not make it available to config.yaml.local.
    const engine = overlay().split(/\r?\n  crowdsec:\r?\n/)[1].split(/\r?\n  crowdsec-postgres:/)[0];
    expect(engine).toContain('CROWDSEC_POSTGRES_PASSWORD: ${CROWDSEC_POSTGRES_PASSWORD:?ERROR - CROWDSEC_POSTGRES_PASSWORD is required}');
  });
});
