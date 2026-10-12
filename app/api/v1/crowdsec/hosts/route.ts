import { NextRequest, NextResponse } from "next/server";
import { requireApiPermission } from "@/src/lib/api-auth";
import { scopeTagsFor } from "@/src/lib/permissions";
import { listCrowdsecHostViews } from "@/src/lib/crowdsec-hosts";
import { CROWDSEC_NO_STORE, crowdsecErrorResponse } from "@/src/lib/crowdsec-api";

/** Every proxy host in the caller's tag scope, with its CrowdSec mode and effective state. */
export async function GET(request: NextRequest) {
  try {
    const { access } = await requireApiPermission(request, "proxy_hosts:read");
    return NextResponse.json(
      { hosts: await listCrowdsecHostViews(scopeTagsFor(access, "proxy_hosts")) },
      { headers: CROWDSEC_NO_STORE }
    );
  } catch (error) {
    return crowdsecErrorResponse(error);
  }
}
