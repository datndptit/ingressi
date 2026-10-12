/**
 * Small helpers shared by the /api/v1/crowdsec routes: the no-store header,
 * the changed-but-not-applied 502, and the generic request helpers the WAF
 * routes use as well.
 */
import { NextResponse } from "next/server";
import { apiErrorResponse, logUnexpectedApiError } from "./api-auth";
import { CaddyApplyError } from "./caddy-apply-error";

export { onlyFields, parseIdParam, readJsonObject } from "./waf-api";

export const CROWDSEC_NO_STORE = { "Cache-Control": "no-store" };

/** apiErrorResponse, with a refused Caddy configuration as 502 (the change was stored, but not applied). */
export function crowdsecErrorResponse(error: unknown): NextResponse {
  if (error instanceof CaddyApplyError) {
    logUnexpectedApiError("CrowdSec change stored but not applied", error);
    return NextResponse.json(
      { error: "The change was saved, but Caddy did not accept the new configuration; it keeps the previous one until the next successful apply" },
      { status: 502 }
    );
  }
  return apiErrorResponse(error);
}
