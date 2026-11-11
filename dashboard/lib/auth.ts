import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const PANEL_SESSION_COOKIE = "netmatter_session";
export const PANEL_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export function getPanelPassword(): string | null {
  return process.env.PANEL_PASSWORD || null;
}

export function isPanelAuthEnabled(): boolean {
  return getPanelPassword() !== null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function passwordMatches(candidate: string, password: string): boolean {
  return timingSafeEqual(digest(candidate), digest(password));
}

function signature(payload: string, password: string): Buffer {
  return createHmac("sha256", password)
    .update(`netmatter-panel-session\0${payload}`, "utf8")
    .digest();
}

export function createPanelSession(
  password: string,
  now = Date.now(),
  nonce = randomBytes(18).toString("base64url"),
): string {
  const expires = Math.floor(now / 1000) + PANEL_SESSION_TTL_SECONDS;
  const payload = `v1.${expires}.${nonce}`;
  return `${payload}.${signature(payload, password).toString("base64url")}`;
}

export function isValidPanelSessionToken(
  token: string | undefined,
  password: string,
  now = Date.now(),
): boolean {
  if (!token) return false;

  const match = /^(v1)\.(\d{10})\.([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;

  const expires = Number(match[2]);
  const nowSeconds = Math.floor(now / 1000);
  if (
    !Number.isSafeInteger(expires) ||
    expires <= nowSeconds ||
    expires > nowSeconds + PANEL_SESSION_TTL_SECONDS + 60
  ) {
    return false;
  }

  const payload = `${match[1]}.${match[2]}.${match[3]}`;
  const actual = Buffer.from(match[4], "base64url");
  const expected = signature(payload, password);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function readCookie(request: Pick<Request, "headers">, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function hasValidPanelSession(
  request: Pick<Request, "headers">,
  now = Date.now(),
): boolean {
  const password = getPanelPassword();
  if (!password) return true;
  return isValidPanelSessionToken(readCookie(request, PANEL_SESSION_COOKIE), password, now);
}

export function unauthorizedPanelResponse(): Response {
  return Response.json(
    { error: "Authentication required" },
    { status: 401, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function requirePanelSession(
  request: Pick<Request, "headers">,
): Response | null {
  return hasValidPanelSession(request) ? null : unauthorizedPanelResponse();
}

export function panelSessionCookieOptions(request: Request) {
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    .trim()
    .toLowerCase();
  const secure = forwardedProtocol === "https" || new URL(request.url).protocol === "https:";

  return {
    httpOnly: true,
    secure,
    sameSite: "strict" as const,
    path: "/",
    maxAge: PANEL_SESSION_TTL_SECONDS,
    priority: "high" as const,
  };
}

export function safePanelRedirect(value: FormDataEntryValue | string | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }

  try {
    const target = new URL(value, "http://netmatter.local");
    if (target.origin !== "http://netmatter.local" || target.pathname === "/login") return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}
