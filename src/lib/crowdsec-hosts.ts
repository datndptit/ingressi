/**
 * The CrowdSec enforcement state of each proxy host: its mode setting
 * (inherit, on, off) and what the global setting and the host's mode add up
 * to. Setting a host's mode goes through updateProxyHost, so it is validated,
 * guarded by change approvals, recorded in the audit log and applied like any
 * host change.
 */
import { getProxyHost, listProxyHosts, updateProxyHost, type ProxyHost } from "./models/proxy-hosts";
import { getCrowdsecSettings, type CrowdsecSettings } from "./settings";
import { hostModeOf, resolveEffectiveCrowdsec, withHostMode, type CrowdsecHostMode } from "./crowdsec-host-mode";

export type CrowdsecHostView = {
  id: number;
  name: string;
  domains: string[];
  /** Whether the proxy host itself is enabled. */
  hostEnabled: boolean;
  /** The host's mode setting. */
  mode: CrowdsecHostMode;
  /** Whether the bouncer enforces CrowdSec for the host right now. */
  effectiveEnabled: boolean;
};

export function crowdsecHostView(host: ProxyHost, global: CrowdsecSettings | null): CrowdsecHostView {
  return {
    id: host.id,
    name: host.name,
    domains: host.domains,
    hostEnabled: host.enabled,
    mode: hostModeOf(host.crowdsec),
    effectiveEnabled: resolveEffectiveCrowdsec(global, host.crowdsec),
  };
}

export async function listCrowdsecHostViews(scopeTags?: readonly string[] | null): Promise<CrowdsecHostView[]> {
  const [hosts, global] = await Promise.all([listProxyHosts(scopeTags), getCrowdsecSettings()]);
  return hosts
    .map((host) => crowdsecHostView(host, global))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Sets a host's mode, keeping everything else about the host. Throws
 * "Proxy host not found" (404) for an unknown host.
 */
export async function setCrowdsecHostMode(id: number, mode: CrowdsecHostMode, actorUserId: number): Promise<CrowdsecHostView> {
  const host = await getProxyHost(id);
  if (!host) throw new Error("Proxy host not found");
  await updateProxyHost(id, { crowdsec: withHostMode(host.crowdsec, mode) }, actorUserId);
  return crowdsecHostView((await getProxyHost(id))!, await getCrowdsecSettings());
}
