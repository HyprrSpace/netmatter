import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  createPanelSession,
  hasValidPanelSession,
  isValidPanelSessionToken,
  PANEL_SESSION_COOKIE,
  PANEL_SESSION_TTL_SECONDS,
  passwordMatches,
  requirePanelSession,
  safePanelRedirect,
} from "./auth";
import { proxy } from "../proxy";
import { POST as login } from "../app/api/auth/login/route";
import { POST as logout } from "../app/api/auth/logout/route";
import { GET as overview } from "../app/api/overview/route";
import { GET as path } from "../app/api/path/route";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const NONCE = "abcdefghijklmnopqrstuvwx";
const originalPassword = process.env.PANEL_PASSWORD;

afterEach(() => {
  if (originalPassword === undefined) delete process.env.PANEL_PASSWORD;
  else process.env.PANEL_PASSWORD = originalPassword;
});

function request(
  pathname = "/",
  init?: ConstructorParameters<typeof NextRequest>[1],
) {
  return new NextRequest(`http://localhost:3000${pathname}`, init);
}

function sessionCookie(password = "test-secret", now = Date.now()) {
  return `${PANEL_SESSION_COOKIE}=${createPanelSession(password, now, NONCE)}`;
}

function loginRequest(password: string, next = "/", url = "http://localhost:3000") {
  return new NextRequest(`${url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password, next }),
  });
}

describe("panel session primitives", () => {
  it("compares the exact password without exposing it", () => {
    assert.equal(passwordMatches("sëcret:密碼: 🔒", "sëcret:密碼: 🔒"), true);
    assert.equal(passwordMatches("sëcret:密碼", "sëcret:密碼: 🔒"), false);
  });

  it("signs expiring sessions and rejects tampering, expiry, and password changes", () => {
    const token = createPanelSession("test-secret", NOW, NONCE);
    assert.equal(isValidPanelSessionToken(token, "test-secret", NOW), true);
    assert.equal(isValidPanelSessionToken(`${token.slice(0, -1)}A`, "test-secret", NOW), false);
    assert.equal(isValidPanelSessionToken(token, "changed-secret", NOW), false);
    assert.equal(
      isValidPanelSessionToken(token, "test-secret", NOW + PANEL_SESSION_TTL_SECONDS * 1000),
      false,
    );
    assert.equal(isValidPanelSessionToken("malformed", "test-secret", NOW), false);
  });

  it("keeps access open only when PANEL_PASSWORD is unset or empty", () => {
    delete process.env.PANEL_PASSWORD;
    assert.equal(hasValidPanelSession(request(), NOW), true);
    process.env.PANEL_PASSWORD = "";
    assert.equal(hasValidPanelSession(request(), NOW), true);

    process.env.PANEL_PASSWORD = "test-secret";
    assert.equal(hasValidPanelSession(request(), NOW), false);
    assert.equal(
      hasValidPanelSession(request("/", { headers: { cookie: sessionCookie("test-secret", NOW) } }), NOW),
      true,
    );
  });

  it("accepts only local return paths", () => {
    assert.equal(safePanelRedirect("/path?range=24h#hop"), "/path?range=24h#hop");
    for (const value of [null, "", "https://evil.example", "//evil.example", "/\\evil", "/login"]) {
      assert.equal(safePanelRedirect(value), "/");
    }
  });
});

describe("panel proxy", () => {
  it("redirects page requests to the login page and returns JSON for APIs", async () => {
    process.env.PANEL_PASSWORD = "test-secret";

    const page = proxy(request("/?range=24h"));
    assert.equal(page.status, 307);
    const location = new URL(page.headers.get("location")!);
    assert.equal(location.pathname, "/login");
    assert.equal(location.searchParams.get("next"), "/?range=24h");
    assert.equal(page.headers.get("cache-control"), "private, no-store");

    const api = proxy(request("/api/overview"));
    assert.equal(api.status, 401);
    assert.deepEqual(await api.json(), { error: "Authentication required" });
    assert.equal(api.headers.get("www-authenticate"), null);
  });

  it("allows public auth routes and valid signed sessions", () => {
    process.env.PANEL_PASSWORD = "test-secret";
    assert.equal(proxy(request("/login")).headers.get("x-middleware-next"), "1");
    assert.equal(proxy(request("/api/auth/login")).headers.get("x-middleware-next"), "1");

    const headers = { cookie: sessionCookie() };
    const panel = proxy(request("/", { headers }));
    assert.equal(panel.headers.get("x-middleware-next"), "1");
    assert.equal(panel.headers.get("cache-control"), "private, no-store");

    const loginPage = proxy(request("/login?next=%2F%3Frange%3D6h", { headers }));
    assert.equal(loginPage.status, 307);
    assert.equal(loginPage.headers.get("location"), "http://localhost:3000/?range=6h");
  });

  it("stays open when password protection is disabled", () => {
    delete process.env.PANEL_PASSWORD;
    assert.equal(proxy(request()).headers.get("x-middleware-next"), "1");
  });
});

describe("login and logout routes", () => {
  it("sets an HttpOnly signed session cookie after a correct password", async () => {
    process.env.PANEL_PASSWORD = "test-secret";
    const response = await login(loginRequest("test-secret", "/?range=24h", "https://panel.example"));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "https://panel.example/?range=24h");

    const setCookie = response.headers.get("set-cookie")!;
    assert.match(setCookie, /^netmatter_session=v1\./);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /Path=\//i);
    assert.match(setCookie, /Max-Age=604800/i);
  });

  it("returns to the form without setting a cookie after a wrong password", async () => {
    process.env.PANEL_PASSWORD = "test-secret";
    const response = await login(loginRequest("wrong", "https://evil.example"));
    assert.equal(response.status, 303);
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.pathname, "/login");
    assert.equal(location.searchParams.get("error"), "invalid");
    assert.equal(location.searchParams.get("next"), null);
    assert.equal(response.headers.get("set-cookie"), null);
  });

  it("clears the session cookie on logout", () => {
    const response = logout(request("/api/auth/logout", { method: "POST" }));
    assert.equal(response.status, 303);
    assert.match(response.headers.get("set-cookie")!, /^netmatter_session=;/);
    assert.match(response.headers.get("set-cookie")!, /Max-Age=0/i);
  });
});

describe("API defense in depth", () => {
  it("guards data routes even when invoked without the proxy", async () => {
    process.env.PANEL_PASSWORD = "test-secret";
    for (const [handler, pathname] of [
      [overview, "/api/overview?range=invalid"],
      [path, "/api/path"],
    ] as const) {
      assert.equal((await handler(request(pathname))).status, 401);
      assert.equal(
        (await handler(request(pathname, { headers: { cookie: sessionCookie() } }))).status,
        400,
      );
    }
  });

  it("returns a no-store unauthorized response", () => {
    process.env.PANEL_PASSWORD = "test-secret";
    const response = requirePanelSession(request());
    assert.equal(response?.status, 401);
    assert.equal(response?.headers.get("cache-control"), "private, no-store");
  });
});
