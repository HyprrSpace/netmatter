import { NextRequest, NextResponse } from "next/server";
import {
  createPanelSession,
  getPanelPassword,
  panelSessionCookieOptions,
  PANEL_SESSION_COOKIE,
  passwordMatches,
  safePanelRedirect,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  const password = getPanelPassword();
  if (!password) return NextResponse.redirect(new URL("/", request.url), 303);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const returnTo = safePanelRedirect(form.get("next"));
  const candidate = form.get("password");
  if (typeof candidate !== "string" || !passwordMatches(candidate, password)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("error", "invalid");
    if (returnTo !== "/") login.searchParams.set("next", returnTo);
    const response = NextResponse.redirect(login, 303);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  const response = NextResponse.redirect(new URL(returnTo, request.url), 303);
  response.cookies.set(
    PANEL_SESSION_COOKIE,
    createPanelSession(password),
    panelSessionCookieOptions(request),
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
