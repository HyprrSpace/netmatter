import { NextRequest, NextResponse } from "next/server";
import {
  panelSessionCookieOptions,
  PANEL_SESSION_COOKIE,
} from "@/lib/auth";

export function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set(PANEL_SESSION_COOKIE, "", {
    ...panelSessionCookieOptions(request),
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
