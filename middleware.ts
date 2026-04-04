import { type NextRequest, NextResponse } from "next/server";

// Auth protection is handled client-side by the (app) layout.
// This middleware just ensures the response passes through cleanly.
export function middleware(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
