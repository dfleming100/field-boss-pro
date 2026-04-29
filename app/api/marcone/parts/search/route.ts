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

    // Marcone uses internal make codes (Whirlpool = "WPL", Samsung = "SAM", etc.)
    // and doesn't fuzzy-match brand names. If the user typed a brand name and
    // we get "not found", retry without the make so the API can resolve by part #.
    let result;
    try {
      result = await lookupPart({ partNumber, make, tntShipToZip });
    } catch (err) {
      const msg = (err as Error).message || "";
      if (make && /not found/i.test(msg)) {
        result = await lookupPart({ partNumber, tntShipToZip });
      } else {
        throw err;
      }
    }

    // Client may still want to filter by make name when a make hint was given.
    let results = result.partResults || [];
    if (make && results.length > 1) {
      const makeLower = make.toLowerCase();
      const filtered = results.filter((p) => {
        const pm = (p.make || "").toLowerCase();
        return pm.includes(makeLower) || makeLower.includes(pm);
      });
      if (filtered.length > 0) results = filtered;
    }

    return NextResponse.json({
      ok: true,
      transaction_id: result.transactionId,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
