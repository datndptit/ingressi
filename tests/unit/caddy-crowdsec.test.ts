/**
 * The CrowdSec integration in the generated Caddy configuration
 * (src/lib/caddy-crowdsec.ts, src/lib/crowdsec-host-mode.ts, buildProxyRoutes
 * in src/lib/caddy.ts):
 *  - the app is emitted only while a served host is enforced, with the
 *    {env.CROWDSEC_API_KEY} placeholder, streaming on and hard fails off;
 *  - the route group sits at the top of the server, before the Blocked
 *    sources list and the host routes that carry rate limiting and the WAF;
 *  - enforced hosts run the handler, exempt hosts keep a handler-less,
 *    non-terminal pass-through route an enabled wildcard cannot override;
 *  - the mode semantics: inherit follows the global setting, on/off override.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

vi.mock('../../src/lib/db', async () => {
  const { createTestDb } = await import('../helpers/db');
  ctx.db = createTestDb();
  return (await import('../helpers/db-module')).mockDbModule(() => ctx.db);
});

vi.mock('../../src/lib/caddy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/caddy')>();
  return { ...actual, applyCaddyConfig: vi.fn().mockResolvedValue({ ok: true }) };
});

vi.mock('../../src/lib/audit', () => ({ logAuditEvent: vi.fn() }));

// Models and settings before src/lib/caddy (see the caddy test mock import order note).
import { createProxyHost, getProxyHost, updateProxyHost } from '../../src/lib/models/proxy-hosts';
import { addBlockedSource } from '../../src/lib/models/access-lists';
import { saveCrowdsecSettings, saveDnsProviderSettings } from '../../src/lib/settings';
import { buildCaddyDocument } from '../../src/lib/caddy';
import { CROWDSEC_ROUTE_GROUP } from '../../src/lib/caddy-crowdsec';
import { resolveEffectiveCrowdsec } from '../../src/lib/crowdsec-host-mode';
import { setCrowdsecHostMode } from '../../src/lib/crowdsec-hosts';
import * as schema from '../../src/lib/db/schema';

type Doc = Awaited<ReturnType<typeof buildCaddyDocument>>;

function server(doc: Doc): Record<string, any> {
  return (doc.apps as any).http.servers.ingressi;
}

function routes(doc: Doc): Array<Record<string, any>> {
  return server(doc).routes as Array<Record<string, any>>;
}

function crowdsecRoutes(doc: Doc): Array<Record<string, any>> {
  return routes(doc).filter((route) => route.group === CROWDSEC_ROUTE_GROUP);
}

function host(name: string, domains: string[], crowdsec?: { mode: 'on' | 'off' } | null) {
  return createProxyHost({ name, domains, upstreams: ['10.0.0.5:8080'], crowdsec }, 1);
}

beforeEach(async () => {
  for (const table of [schema.proxyHosts, schema.accessListRules, schema.accessListEntries, schema.accessLists, schema.settings]) {
    await ctx.db.delete(table);
  }
  await ctx.db.delete(schema.users).catch(() => {});
  await ctx.db.insert(schema.users).values({
    id: 1, email: 'admin@example.com', name: 'Admin', role: 'admin', provider: 'credentials', subject: 'admin',
    status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
});

describe('mode semantics', () => {
  it('inherit follows the global setting; on/off override it either way', () => {
    expect(resolveEffectiveCrowdsec(null, null)).toBe(false);
    expect(resolveEffectiveCrowdsec({ enabled: false }, null)).toBe(false);
    expect(resolveEffectiveCrowdsec({ enabled: true }, null)).toBe(true);
    expect(resolveEffectiveCrowdsec({ enabled: true }, { mode: 'off' })).toBe(false);
    expect(resolveEffectiveCrowdsec({ enabled: false }, { mode: 'on' })).toBe(true);
  });

  it('stores only on/off in meta; inherit stores nothing and unknown modes are refused', async () => {
    const enforced = await host('enforced', ['enforced.example.com'], { mode: 'on' });
    expect(enforced.crowdsec).toEqual({ mode: 'on' });

    const inherited = await host('inherited', ['inherited.example.com']);
    expect(inherited.crowdsec).toBeNull();

    // Setting inherit drops the stored value again.
    const reset = await updateProxyHost(enforced.id, { crowdsec: null }, 1);
    expect(reset.crowdsec).toBeNull();

    await expect(
      updateProxyHost(enforced.id, { crowdsec: { mode: 'nope' as never } }, 1)
    ).rejects.toThrow(/crowdsec\.mode must be inherit, on or off/);
  });

  it('sets a host mode through the model (validation, approvals, audit, apply)', async () => {
    const plain = await host('app', ['app.example.com']);

    const view = await setCrowdsecHostMode(plain.id, 'on', 1);
    expect(view).toMatchObject({ id: plain.id, mode: 'on', effectiveEnabled: true });
    expect((await getProxyHost(plain.id))!.crowdsec).toEqual({ mode: 'on' });

    const inherited = await setCrowdsecHostMode(plain.id, 'inherit', 1);
    expect(inherited.mode).toBe('inherit');
    expect((await getProxyHost(plain.id))!.crowdsec).toBeNull();

    await expect(setCrowdsecHostMode(9999, 'on', 1)).rejects.toThrow('Proxy host not found');
  });
});

describe('the CrowdSec app and routes in buildCaddyDocument', () => {
  it('emits nothing while no served host is enforced', async () => {
    await host('plain', ['app.example.com']);
    await host('exempt', ['exempt.example.com'], { mode: 'off' });
    await saveCrowdsecSettings({ enabled: false });

    const doc = await buildCaddyDocument();
    expect((doc.apps as any).crowdsec).toBeUndefined();
    expect(crowdsecRoutes(doc)).toEqual([]);
  });

  it('emits the app and the handler route for an enforced host, before the host route', async () => {
    await host('app', ['app.example.com']);
    await saveCrowdsecSettings({ enabled: true });

    const doc = await buildCaddyDocument();
    expect((doc.apps as any).crowdsec).toEqual({
      api_url: 'http://crowdsec:8080/',
      api_key: '{env.CROWDSEC_API_KEY}',
      ticker_interval: '15s',
      enable_streaming: true,
      enable_hard_fails: false,
    });
    const bouncer = crowdsecRoutes(doc);
    expect(bouncer).toHaveLength(1);
    expect(bouncer[0]).toEqual({
      match: [{ host: ['app.example.com'] }],
      group: 'crowdsec',
      handle: [{ handler: 'crowdsec' }],
    });
    // At the very top of the server, before the host's own (terminal) route.
    const all = routes(doc);
    const hostRoute = all.findIndex(
      (route) => route.match?.[0]?.host?.includes('app.example.com') && route.terminal
    );
    expect(hostRoute).toBeGreaterThan(0);
    expect(all.indexOf(bouncer[0])).toBe(0);
    expect(all.indexOf(bouncer[0])).toBeLessThan(hostRoute);
  });

  it('keeps CrowdSec ahead of the Blocked sources list', async () => {
    await host('app', ['app.example.com']);
    await saveCrowdsecSettings({ enabled: true });
    await addBlockedSource({ address: '198.51.100.7' }, 1);

    const doc = await buildCaddyDocument();
    const all = routes(doc);
    const bouncer = crowdsecRoutes(doc);
    expect(bouncer).toHaveLength(1);
    // The blocked sources route has no host matcher; it must come after.
    const blocked = all.findIndex((route) => !route.match && route.handle);
    expect(blocked).toBeGreaterThan(all.indexOf(bouncer[0]));
  });

  it('enforces a host that turns CrowdSec on while the global setting is off', async () => {
    await host('on', ['on.example.com'], { mode: 'on' });
    await host('inherit', ['inherit.example.com']);
    await saveCrowdsecSettings({ enabled: false });

    const doc = await buildCaddyDocument();
    const byHost = Object.fromEntries(crowdsecRoutes(doc).map((route) => [route.match[0].host[0], route]));
    expect(byHost['on.example.com'].handle).toEqual([{ handler: 'crowdsec' }]);
    expect(byHost['inherit.example.com'].handle).toBeUndefined();
    expect(byHost['inherit.example.com'].terminal).toBeUndefined();
  });

  it('exempts a specific host from an enforced wildcard host', async () => {
    // Wildcard domains need a DNS-01 provider to be issuable at all.
    await saveDnsProviderSettings({ providers: { cloudflare: { api_token: 'ci-token' } }, default: 'cloudflare' });
    await host('wildcard', ['*.example.com']);
    await host('exempt', ['shop.example.com'], { mode: 'off' });
    await saveCrowdsecSettings({ enabled: true });

    const doc = await buildCaddyDocument();
    const bouncer = crowdsecRoutes(doc);
    // The specific host's pass-through route comes first; the wildcard that
    // would enforce it cannot run (same route group) and the pass-through
    // route does not stop the regular chain.
    expect(bouncer.map((route) => route.match[0].host[0])).toEqual(['shop.example.com', '*.example.com']);
    expect(bouncer[0].handle).toBeUndefined();
    expect(bouncer[0].terminal).toBeUndefined();
    expect(bouncer[1].handle).toEqual([{ handler: 'crowdsec' }]);
  });
});
