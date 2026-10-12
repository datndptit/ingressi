import { NextRequest, NextResponse } from "next/server";
import { requireApiPermission } from "@/src/lib/api-auth";
import { ApiClientError, ApiValidationError } from "@/src/lib/api-errors";
import { findProxyHostInScope } from "@/src/lib/access-scope";
import { getCrowdsecSettings } from "@/src/lib/settings";
import { CROWDSEC_HOST_MODES, isCrowdsecHostMode } from "@/src/lib/crowdsec-host-mode";
import { crowdsecHostView, setCrowdsecHostMode } from "@/src/lib/crowdsec-hosts";
import { CROWDSEC_NO_STORE, crowdsecErrorResponse, onlyFields, parseIdParam, readJsonObject } from "@/src/lib/crowdsec-api";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { access } = await requireApiPermission(request, "proxy_hosts:read");
    // 404 for a host outside the caller's tag scope, as for a missing one.
    const host = await findProxyHostInScope(access, parseIdParam((await params).id, "id"));
    if (!host) throw new ApiClientError("Proxy host not found", 404);
    return NextResponse.json(crowdsecHostView(host, await getCrowdsecSettings()), { headers: CROWDSEC_NO_STORE });
  } catch (error) {
    return crowdsecErrorResponse(error);
  }
}

/** Sets the host's CrowdSec mode (inherit, on or off); everything else stays. */
export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const { userId, access } = await requireApiPermission(request, "proxy_hosts:write");
    const id = parseIdParam((await params).id, "id");
    const existing = await findProxyHostInScope(access, id);
    if (!existing) throw new ApiClientError("Proxy host not found", 404);
    const body = await readJsonObject(request);
    onlyFields(body, ["mode"]);
    if (!isCrowdsecHostMode(body.mode)) throw new ApiValidationError(`mode must be one of ${CROWDSEC_HOST_MODES.join(", ")}`);
    return NextResponse.json(await setCrowdsecHostMode(existing.id, body.mode, userId), { headers: CROWDSEC_NO_STORE });
  } catch (error) {
    return crowdsecErrorResponse(error);
  }
}
