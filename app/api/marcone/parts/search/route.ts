import { NextRequest, NextResponse } from "next/server";
import { lookupPart } from "@/lib/marcone";

// GET /api/marcone/parts/search?part_number=W10130913&make=Whirlpool
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const partNumber = url.searchParams.get("part_number")?.trim();
    const make = url.searchParams.get("make")?.trim() || undefined;
    const tntShipToZip = url.searchParams.get("zip")?.trim() || undefined;

    if (!partNumber) {
      return NextResponse.json(
        { ok: false, error: "part_number query param is required" },
        { status: 400 }
      );
    }

    const result = await lookupPart({ partNumber, make, tntShipToZip });
    return NextResponse.json({
      ok: true,
      transaction_id: result.transactionId,
      results: result.partResults || [],
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
