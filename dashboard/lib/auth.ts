import { createHash, timingSafeEqual } from "node:crypto";

// Read at request time so the same image can run with or without panel auth.
// Return a challenge before serving either the panel or its data endpoints.
export function requirePanelAuth(request: Pick<Request, "headers">): Response | null {
  const password = process.env.PANEL_PASSWORD;
  if (!password) return null;

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
  if (match) {
    const actual = createHash("sha256")
      .update(Buffer.from(match[1], "base64"))
      .digest();
    const expected = createHash("sha256").update(`admin:${password}`, "utf8").digest();
    if (timingSafeEqual(actual, expected)) return null;
  }

  return Response.json(
    { error: "Authentication required" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="netmatter", charset="UTF-8"',
        "Cache-Control": "private, no-store",
      },
    },
  );
}
