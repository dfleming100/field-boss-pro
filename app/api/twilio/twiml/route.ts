import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/twilio/twiml
 * TwiML endpoint for outbound browser calls.
 * Twilio hits this when a call is initiated from the browser softphone.
 * Returns TwiML that dials the customer's number with the business caller ID.
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const to = formData.get("To")?.toString() || "";
  const callerId = formData.get("CallerId")?.toString() || "+18552693196";

  // Ensure the "To" number is in E.164 format
  let dialNumber = to;
  const digits = to.replace(/\D/g, "");
  if (digits.length === 10) {
    dialNumber = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    dialNumber = `+${digits}`;
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}">
    <Number>${dialNumber}</Number>
  </Dial>
</Response>`;

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
