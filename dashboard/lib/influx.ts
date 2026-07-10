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
    throw new Error(`InfluxDB query failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T[]>;
}

// Quote + escape a string literal for safe interpolation into SQL.
export function sqlStr(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Build an `IN (...)` list from string values; returns null if empty (= no filter).
export function sqlInList(values: string[]): string | null {
  if (values.length === 0) return null;
  return `(${values.map(sqlStr).join(", ")})`;
}

// Allowed time ranges → { influx interval, bucket width }. Bounded by Core's ~72h window.
export const RANGES: Record<string, { interval: string; bucket: string }> = {
  "15m": { interval: "15 minutes", bucket: "30 seconds" },
  "1h": { interval: "1 hour", bucket: "1 minute" },
  "3h": { interval: "3 hours", bucket: "2 minutes" },
  "6h": { interval: "6 hours", bucket: "5 minutes" },
  "24h": { interval: "24 hours", bucket: "15 minutes" },
  "72h": { interval: "72 hours", bucket: "30 minutes" },
};

export type HopMode = "perhop" | "avg" | "max";
