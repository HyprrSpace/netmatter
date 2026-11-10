import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { requirePanelAuth } from "./auth";
import { proxy } from "../proxy";
import { GET as overview } from "../app/api/overview/route";
import { GET as path } from "../app/api/path/route";

const originalPassword = process.env.PANEL_PASSWORD;
afterEach(() => {
  if (originalPassword === undefined) delete process.env.PANEL_PASSWORD;
  else process.env.PANEL_PASSWORD = originalPassword;
});

function request(authorization?: string, pathname = "/") {
  return new NextRequest(`http://localhost:3000${pathname}`, {
    headers: authorization === undefined ? {} : { authorization },
  });
}

function basic(credentials: string) {
  return `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
}

describe("panel authentication", () => {
  it("allows open access when the password is unset or empty", () => {
    delete process.env.PANEL_PASSWORD;
    assert.equal(requirePanelAuth(request()), null);
    process.env.PANEL_PASSWORD = "";
    assert.equal(requirePanelAuth(request("Bearer ignored")), null);
  });

  it("challenges missing, incorrect, or malformed credentials", async () => {
    process.env.PANEL_PASSWORD = "test-secret";
    for (const authorization of [
      undefined,
      "Bearer test-secret",
      "Basic !!!",
      "Basic",
      basic("admin"),
      basic("admin:"),
      basic("admin:wrong"),
      basic("other:test-secret"),
      basic("admin:test-secret:extra"),
    ]) {
      const response = requirePanelAuth(request(authorization));
      assert.equal(response?.status, 401);
      assert.equal(response?.headers.get("www-authenticate"),
        'Basic realm="netmatter", charset="UTF-8"');
      assert.equal(response?.headers.get("cache-control"), "private, no-store");
      assert.doesNotMatch(await response!.text(), /test-secret/);
    }
  });

  it("accepts the admin username and exact password, including Unicode and colons", () => {
    process.env.PANEL_PASSWORD = "sëcret:密碼: 🔒";
    assert.equal(requirePanelAuth(request(basic("admin:sëcret:密碼: 🔒"))), null);
    assert.equal(requirePanelAuth(request(basic("admin:sëcret:密碼: 🔒").replace("Basic", "basic"))), null);
  });

  it("reads password changes at runtime", () => {
    process.env.PANEL_PASSWORD = "first";
    assert.equal(requirePanelAuth(request(basic("admin:first"))), null);
    process.env.PANEL_PASSWORD = "second";
    assert.equal(requirePanelAuth(request(basic("admin:first")))?.status, 401);
    assert.equal(requirePanelAuth(request(basic("admin:second"))), null);
  });

  it("protects the panel, API paths, and RSC requests through the proxy", () => {
    process.env.PANEL_PASSWORD = "test-secret";
    for (const pathname of ["/", "/?range=24h", "/?_rsc=example", "/api/overview", "/api/path"]) {
      assert.equal(proxy(request(undefined, pathname)).status, 401);
      const response = proxy(request(basic("admin:test-secret"), pathname));
      assert.equal(response.headers.get("x-middleware-next"), "1");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
  });

  it("keeps the proxy open when authentication is disabled", () => {
    delete process.env.PANEL_PASSWORD;
    const response = proxy(request());
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(response.headers.get("cache-control"), null);
  });

  it("guards data routes even when invoked without the proxy", async () => {
    process.env.PANEL_PASSWORD = "test-secret";
    for (const [handler, pathname] of [
      [overview, "/api/overview?range=invalid"],
      [path, "/api/path"],
    ] as const) {
      assert.equal((await handler(request(undefined, pathname))).status, 401);
      assert.equal((await handler(request(basic("admin:wrong"), pathname))).status, 401);
      // Authentication succeeds before the normal input validation runs.
      assert.equal((await handler(request(basic("admin:test-secret"), pathname))).status, 400);
      delete process.env.PANEL_PASSWORD;
      assert.equal((await handler(request(undefined, pathname))).status, 400);
      process.env.PANEL_PASSWORD = "test-secret";
    }
  });
});
