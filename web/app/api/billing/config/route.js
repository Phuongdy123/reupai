import { NextResponse } from "next/server";
import { paymentConfigured, quotaConfigured } from "../../../../src/lib/billing";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ enabled: quotaConfigured(), paymentsEnabled: paymentConfigured() }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
