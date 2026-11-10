import { NextResponse, type NextRequest } from "next/server";
import { requirePanelAuth } from "@/lib/auth";

export function proxy(request: NextRequest) {
  const challenge = requirePanelAuth(request);
  if (challenge) return challenge;

  const response = NextResponse.next();
  if (process.env.PANEL_PASSWORD) {
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
