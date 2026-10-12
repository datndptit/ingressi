import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildWafHandler, buildWafHandlerEntry, filterCustomDirectives,
  resolveEffectiveWaf, RAW_BODY_RULE, WEBSOCKET_UPGRADE_MATCHER,
} from '../../src/lib/caddy-waf';

const rules = (name: string) => readFileSync(resolve('documentation/examples/argus', name), 'utf8');
const base = { enabled: true, mode: 'On' as const, load_owasp_crs: true, custom_directives: '' };

describe('Argus rules with the current Ingressi WAF builder', () => {
  it.each(['detect.conf', 'block.conf', 'detect-tx-threshold.conf'])('%s survives filtering and follows CRS', (name) => {
    const custom = rules(name);
    const filtered = filterCustomDirectives(custom, { crsLoaded: true });
    expect(filtered.dropped).toEqual([]);
    const handler = buildWafHandler({ ...base, custom_directives: custom });
    const directives = handler.directives as string;
    expect(handler.load_owasp_crs).toBe(true);
    expect(directives).toContain(RAW_BODY_RULE);
    for (const line of filtered.kept) expect(directives).toContain(line);
    expect(directives.indexOf('Include @owasp_crs/*.conf')).toBeLessThan(directives.indexOf(',mlcheck'));
    expect(directives).toContain('ctl:auditEngine=On');
    expect(directives).toContain('TX:argus_is_clean "@streq 0"');
  });

  it('keeps a per-host threshold before its ML action in override mode', () => {
    const effective = resolveEffectiveWaf({ ...base, custom_directives: rules('detect.conf') }, {
      ...base, waf_mode: 'override', custom_directives: rules('detect-tx-threshold.conf'),
    })!;
    const directives = buildWafHandler(effective).directives as string;
    expect((directives.match(/,mlcheck/g) ?? []).length).toBe(1);
    expect(directives.indexOf('setvar:tx.argus_threshold')).toBeLessThan(directives.indexOf(',mlcheck'));
  });

  it('passes only WebSocket upgrades around WAF when allowWebsocket is enabled', () => {
    const waf = { ...base, custom_directives: rules('block.conf') };
    expect(buildWafHandlerEntry(waf, true)).toEqual({
      handler: 'subroute', routes: [{
        match: [{ not: [WEBSOCKET_UPGRADE_MATCHER] }], handle: [buildWafHandler(waf)],
      }],
    });
    expect(buildWafHandlerEntry(waf, false).handler).toBe('waf');
  });

  it('retains the ML overlay during L4 port-manager recreation', () => {
    const overlay = readFileSync(resolve('docker-compose.argus.yml'), 'utf8');
    const manager = readFileSync(resolve('docker/l4-port-manager/entrypoint.sh'), 'utf8');
    expect(overlay).toContain('COMPOSE_EXTRA_FILE: /compose/docker-compose.argus.yml');
    expect(manager).toContain('-f $COMPOSE_EXTRA_FILE');
    expect(manager).toContain('--pull never');
  });
});
