// Server-side InfluxDB 3 SQL query helper. The token never leaves the server.
const HOST = process.env.INFLUX_HOST ?? "http://localhost:8181";
const TOKEN = process.env.INFLUX_TOKEN ?? "";
const DB = process.env.INFLUX_DATABASE ?? "mtr";

export async function queryInflux<T = Record<string, unknown>>(
  sql: string,
): Promise<T[]> {
  const res = await fetch(`${HOST}/api/v3/query_sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ db: DB, q: sql, format: "json" }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    // Before the first agent write there is no database / `mtr` table yet —
    // treat that as "no rows" rather than an outage.
    if (/database not found|table '[^']*\bmtr' not found/i.test(body)) return [];
    throw new Error(`InfluxDB query failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T[]>;
}

// Quote + escape a string literal for safe interpolation into SQL.
export function sqlStr(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Influx returns timestamps as naive ISO strings in UTC ("2026-10-10T07:37:45").
// Date.parse would read those as local time, so pin them to UTC.
export function parseTime(t: string | number): number {
  if (typeof t === "number") return t;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
}

// Allowed time ranges → influx interval + bucket width. Buckets are wider than
// the agent's ~70s probe cycle so a healthy series has no holes. Bounded by
// Core's ~72h query window.
export const RANGES: Record<
  string,
  { interval: string; bucket: string; ms: number; bucketMs: number }
> = {
  "15m": { interval: "15 minutes", bucket: "1 minute", ms: 15 * 60e3, bucketMs: 60e3 },
  "1h": { interval: "1 hour", bucket: "2 minutes", ms: 3600e3, bucketMs: 120e3 },
  "3h": { interval: "3 hours", bucket: "5 minutes", ms: 3 * 3600e3, bucketMs: 300e3 },
  "6h": { interval: "6 hours", bucket: "10 minutes", ms: 6 * 3600e3, bucketMs: 600e3 },
  "24h": { interval: "24 hours", bucket: "30 minutes", ms: 24 * 3600e3, bucketMs: 1800e3 },
  "72h": { interval: "72 hours", bucket: "1 hour", ms: 72 * 3600e3, bucketMs: 3600e3 },
};

export const bucketExpr = (bucket: string) =>
  `date_bin(INTERVAL '${bucket}', time, TIMESTAMP '1970-01-01T00:00:00Z')`;

// CTE `final`: one row per mtr run (node, destination, time) holding the last
// hop — i.e. what the destination itself saw. Hop tags are zero-padded
// ("07-host"), so the lexically largest hop is the deepest one.
export function finalHopCte(where: string): string {
  return `final AS (
    SELECT time, node, destination, hop, loss, "avg", best, wrst, stdev
    FROM (
      SELECT time, node, destination, hop, loss, "avg", best, wrst, stdev,
        ROW_NUMBER() OVER (PARTITION BY node, destination, time ORDER BY hop DESC) AS rn
      FROM mtr WHERE ${where}
    ) WHERE rn = 1
  )`;
}

export function errorResponse(err: unknown) {
  return Response.json(
    { error: err instanceof Error ? err.message : "query failed" },
    { status: 502 },
  );
}
