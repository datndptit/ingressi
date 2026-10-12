/**
 * The CrowdSec mode of one proxy host: inherit the global setting, on
 * (enforced) or off (exempt). Stored in the host's meta.crowdsec as `{ mode }`;
 * a host without the key inherits, so older databases and hosts that never
 * touched CrowdSec read the same way. The LAPI URL, the bouncer key and the
 * polling interval are deployment configuration (docker-compose.crowdsec.yml),
 * not part of this setting.
 */
import type { CrowdsecHostConfig } from "./models/proxy-hosts";
import type { CrowdsecSettings } from "./settings";

export const CROWDSEC_HOST_MODES = ["inherit", "on", "off"] as const;
export type CrowdsecHostMode = (typeof CROWDSEC_HOST_MODES)[number];

export function isCrowdsecHostMode(value: unknown): value is CrowdsecHostMode {
  return (CROWDSEC_HOST_MODES as readonly unknown[]).includes(value);
}

/** The host's mode setting as stored in meta.crowdsec. */
export function hostModeOf(crowdsec: CrowdsecHostConfig | null | undefined): CrowdsecHostMode {
  if (crowdsec?.mode === "on" || crowdsec?.mode === "off") return crowdsec.mode;
  return "inherit";
}

/**
 * The host's setting with `mode` set. "inherit" stores nothing (see
 * hostModeOf): the host follows the global setting again. on/off override the
 * global setting either way — the global value is the default hosts inherit,
 * not a switch that forces every host.
 */
export function withHostMode(crowdsec: CrowdsecHostConfig | null | undefined, mode: CrowdsecHostMode): CrowdsecHostConfig | null {
  void crowdsec;
  return mode === "inherit" ? null : { mode };
}

/** Whether the bouncer enforces CrowdSec for the host, global and host modes combined. */
export function resolveEffectiveCrowdsec(
  global: CrowdsecSettings | null | undefined,
  crowdsec: CrowdsecHostConfig | null | undefined
): boolean {
  const mode = hostModeOf(crowdsec);
  if (mode === "on") return true;
  if (mode === "off") return false;
  return Boolean(global?.enabled);
}
