import { NextResponse } from "next/server";
import { getMarconeToken, getMarconeCustomerNumber } from "@/lib/marcone";

// Health-check endpoint — verifies we can fetch a Marcone OAuth token.
// Hit this in the browser to confirm the env vars are correct and the
// integration env is reachable. Don't ship to production-facing UI.
export async function GET() {
  try {
    const token = await getMarconeToken();
    return NextResponse.json({
      ok: true,
      token_preview: `${token.slice(0, 16)}...${token.slice(-8)}`,
      token_length: token.length,
      customer_number: getMarconeCustomerNumber(),
      base_url: process.env.MSUPPLY_BASE_URL,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
