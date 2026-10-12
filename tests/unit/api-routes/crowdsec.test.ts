import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/src/lib/api-auth', () => {
  const ApiAuthError = class extends Error {
    status: number;
    constructor(msg: string, status: number) { super(msg); this.status = status; this.name = 'ApiAuthError'; }
  };
  return {
    requireApiPermission: vi.fn((request: unknown) => import('@/tests/helpers/permission-mocks').then((m) => m.viaRequireApiAdmin(request))),
    requireApiAdmin: vi.fn().mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' }),
    apiErrorResponse: vi.fn((error: unknown) => {
      const { NextResponse: NR } = require('next/server');
      if (error instanceof ApiAuthError) {
        return NR.json({ error: error.message }, { status: error.status });
      }
      const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 500;
      return NR.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status });
    }),
    logUnexpectedApiError: vi.fn(),
    ApiAuthError,
  };
});

vi.mock('@/src/lib/crowdsec-hosts', () => ({
  listCrowdsecHostViews: vi.fn(),
  crowdsecHostView: vi.fn((host: { id: number; crowdsec?: { mode?: string } | null }) => ({
    id: host.id,
    mode: host.crowdsec?.mode ?? 'inherit',
    effectiveEnabled: true,
  })),
  setCrowdsecHostMode: vi.fn(),
}));

vi.mock('@/src/lib/access-scope', () => ({ findProxyHostInScope: vi.fn() }));

vi.mock('@/src/lib/settings', () => ({ getCrowdsecSettings: vi.fn().mockResolvedValue({ enabled: true }) }));

import { GET as listGET } from '@/app/api/v1/crowdsec/hosts/route';
import { GET as getGET, PUT } from '@/app/api/v1/crowdsec/hosts/[id]/route';
import { listCrowdsecHostViews, setCrowdsecHostMode } from '@/src/lib/crowdsec-hosts';
import { findProxyHostInScope } from '@/src/lib/access-scope';

const mockList = vi.mocked(listCrowdsecHostViews);
const mockSetMode = vi.mocked(setCrowdsecHostMode);
const mockFind = vi.mocked(findProxyHostInScope);

function createMockRequest(options: { method?: string; body?: unknown } = {}): any {
  return {
    headers: { get: () => null },
    method: options.method ?? 'GET',
    nextUrl: { pathname: '/api/v1/crowdsec/hosts', searchParams: new URLSearchParams() },
    json: async () => options.body ?? {},
  };
}

const sampleHost = {
  id: 7,
  name: 'App',
  domains: ['app.example.com'],
  hostEnabled: true,
  mode: 'inherit',
  effectiveEnabled: false,
  tags: [],
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockFind.mockResolvedValue(sampleHost);
});

describe('GET /api/v1/crowdsec/hosts', () => {
  it('lists the hosts in the caller scope, with no-store', async () => {
    mockList.mockResolvedValue([sampleHost]);
    const response = await listGET(createMockRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ hosts: [sampleHost] });
  });
});

describe('GET /api/v1/crowdsec/hosts/[id]', () => {
  it('returns the host view from the scope lookup', async () => {
    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '7' }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ id: 7, mode: 'inherit' });
  });

  it('answers 404 outside the tag scope, like a missing host', async () => {
    mockFind.mockResolvedValue(null);
    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '7' }) });
    expect(response.status).toBe(404);
  });
});

describe('PUT /api/v1/crowdsec/hosts/[id]', () => {
  it('sets the mode through the model update', async () => {
    mockSetMode.mockResolvedValue({ ...sampleHost, mode: 'off', effectiveEnabled: false });
    const response = await PUT(createMockRequest({ method: 'PUT', body: { mode: 'off' } }), {
      params: Promise.resolve({ id: '7' }),
    });
    expect(response.status).toBe(200);
    expect(mockSetMode).toHaveBeenCalledWith(7, 'off', 1);
    expect(await response.json()).toMatchObject({ mode: 'off' });
  });

  it('rejects an unknown mode and unknown fields', async () => {
    const bad = await PUT(createMockRequest({ method: 'PUT', body: { mode: 'always' } }), {
      params: Promise.resolve({ id: '7' }),
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain('mode must be one of inherit, on, off');

    const extra = await PUT(createMockRequest({ method: 'PUT', body: { mode: 'on', extra: true } }), {
      params: Promise.resolve({ id: '7' }),
    });
    expect(extra.status).toBe(400);
    expect((await extra.json()).error).toContain('Unknown field: extra');
  });

  it('refuses a host outside the tag scope with 404', async () => {
    mockFind.mockResolvedValue(null);
    const response = await PUT(createMockRequest({ method: 'PUT', body: { mode: 'on' } }), {
      params: Promise.resolve({ id: '7' }),
    });
    expect(response.status).toBe(404);
  });
});
