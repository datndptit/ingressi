/**
 * The CrowdSec HTTP bouncer entries of the Caddy configuration
 * (github.com/hslatman/caddy-crowdsec-bouncer): the `crowdsec` app and the
 * per-host routes that enforce it. Ingressi generates the entire configuration
 * on every apply, so both come from the same buildCaddyDocument() pass.
 *
 * The routes sit at the top of the main server, before the Blocked sources
 * list, rate limiting and the WAF, inside one route group: only the first
 * matching route of a group runs. An enforced host gets the `crowdsec`
 * handler; an exempt host keeps a handler-less route in the group so an
 * enabled wildcard host cannot catch it — that route also is not terminal,
 * so the request goes on to the regular chain either way.
 */
import { groupHostPatternsByPriority, sortRoutesByHostPriority } from "./host-pattern-priority";

/** The route group every CrowdSec route shares; the plugin app and handler ids. */
export const CROWDSEC_ROUTE_GROUP = "crowdsec";
const CROWDSEC_HANDLER = "crowdsec";

/**
 * The LAPI address and polling interval of the generated configuration. Both
 * are deployment configuration (docker-compose.crowdsec.yml), not settings:
 * `crowdsec` is the service name of the Security Engine on the compose
 * network. The app's defaults would be 127.0.0.1:8080 and 60s.
 */
const CROWDSEC_API_URL = "http://crowdsec:8080/";
const CROWDSEC_TICKER_INTERVAL = "15s";

type CaddyHttpRoute = Record<string, unknown>;

export type CrowdsecRouteHost = {
  /** The host's domain patterns, as the builder serves them. */
  domains: string[];
  /** Whether the bouncer enforces CrowdSec for this host. */
  enabled: boolean;
};

/**
 * The Caddy `crowdsec` app. The API key is a placeholder: each node's caddy
 * container supplies the real value in CROWDSEC_API_KEY, which the plugin's
 * Provision substitutes at load time — the key never reaches the Ingressi
 * database, API responses or the audit log. Streaming keeps the decisions in
 * memory (no LAPI call per request) and hard fails stay off, so a LAPI outage
 * never stops Caddy from serving.
 */
export function buildCrowdsecApp(): Record<string, unknown> {
  return {
    api_url: CROWDSEC_API_URL,
    api_key: "{env.CROWDSEC_API_KEY}",
    ticker_interval: CROWDSEC_TICKER_INTERVAL,
    enable_streaming: true,
    enable_hard_fails: false,
  };
}

/** The `crowdsec` HTTP handler entry; the Caddy image must carry the bouncer. */
export function buildCrowdsecHandlerEntry(): Record<string, unknown> {
  return { handler: CROWDSEC_HANDLER };
}

/**
 * The CrowdSec route group for the served hosts: an enforced host runs the
 * handler, an exempt host keeps its pass-through route. Without a single
 * enforced host there is nothing to emit — no app, no routes.
 */
export function buildCrowdsecRoutePlan(
  hosts: readonly CrowdsecRouteHost[]
): { routes: CaddyHttpRoute[]; enabled: boolean } {
  if (!hosts.some((host) => host.enabled)) {
    return { routes: [], enabled: false };
  }
  const routes: CaddyHttpRoute[] = [];
  for (const host of hosts) {
    for (const domainGroup of groupHostPatternsByPriority(host.domains)) {
      routes.push({
        match: [{ host: domainGroup }],
        group: CROWDSEC_ROUTE_GROUP,
        ...(host.enabled ? { handle: [buildCrowdsecHandlerEntry()] } : {}),
      });
    }
  }
  // The same specificity ordering the host routes use: an exempt host's route
  // must be matched before the enabled wildcard it sits under.
  return { routes: sortRoutesByHostPriority(routes), enabled: true };
}
