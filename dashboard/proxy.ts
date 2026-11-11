import { NextResponse, type NextRequest } from "next/server";
import {
  hasValidPanelSession,
  isPanelAuthEnabled,
  safePanelRedirect,
  unauthorizedPanelResponse,
} from "@/lib/auth";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);

export function proxy(request: NextRequest) {
  if (!isPanelAuthEnabled()) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) {
    if (pathname === "/login" && hasValidPanelSession(request)) {
      return NextResponse.redirect(
        new URL(safePanelRedirect(request.nextUrl.searchParams.get("next")), request.url),
      );
    }
    return NextResponse.next();
  }

  if (hasValidPanelSession(request)) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  if (pathname.startsWith("/api/")) return unauthorizedPanelResponse();

  const login = new URL("/login", request.url);
  login.searchParams.set("next", safePanelRedirect(`${pathname}${search}`));
  const response = NextResponse.redirect(login);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
