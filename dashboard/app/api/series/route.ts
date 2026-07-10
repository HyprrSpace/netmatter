import { NextRequest, NextResponse } from "next/server";
import {
  queryInflux,
  sqlStr,
  sqlInList,
  RANGES,
  HopMode,
} from "@/lib/influx";

const EPOCH = "TIMESTAMP '1970-01-01T00:00:00Z'";

type Row = { t: string | number; node: string; hop?: string; loss: number };

// Returns time-bucketed loss series for the chart.
// Params:
//   destination (required), range (RANGES key), mode (perhop|avg|max),
//   nodes (csv, empty = all), hops (csv, empty = all; only used in perhop mode)
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const destination = p.get("destination");
  const range = p.get("range") ?? "1h";
  const mode = (p.get("mode") ?? "perhop") as HopMode;
  const nodes = (p.get("nodes") ?? "").split(",").filter(Boolean);
  const hops = (p.get("hops") ?? "").split(",").filter(Boolean);

  if (!destination) {
    return NextResponse.json({ error: "destination is required" }, { status: 400 });
  }
  const r = RANGES[range];
  if (!r) {
    return NextResponse.json({ error: "invalid range" }, { status: 400 });
  }
  if (!["perhop", "avg", "max"].includes(mode)) {
    return NextResponse.json({ error: "invalid mode" }, { status: 400 });
  }

  const filters = [
    `destination = ${sqlStr(destination)}`,
    `time > now() - INTERVAL '${r.interval}'`,
  ];
  const nodeIn = sqlInList(nodes);
  if (nodeIn) filters.push(`node IN ${nodeIn}`);

  const bucket = `date_bin(INTERVAL '${r.bucket}', time, ${EPOCH})`;

  let sql: string;
  if (mode === "perhop") {
    const hopIn = sqlInList(hops);
    if (hopIn) filters.push(`hop IN ${hopIn}`);
    sql = `SELECT ${bucket} AS t, node, hop, avg(loss) AS loss
           FROM mtr WHERE ${filters.join(" AND ")}
           GROUP BY t, node, hop ORDER BY t`;
  } else {
    const agg = mode === "max" ? "max(loss)" : "avg(loss)";
    sql = `SELECT ${bucket} AS t, node, ${agg} AS loss
           FROM mtr WHERE ${filters.join(" AND ")}
           GROUP BY t, node ORDER BY t`;
  }

  try {
    const rows = await queryInflux<Row>(sql);
    const multiNode =
      new Set(rows.map((row) => row.node)).size > 1;

    // series key: identify each line. include node only when >1 node present.
    const seriesKeys = new Set<string>();
    const buckets = new Map<number, Record<string, number | string>>();

    for (const row of rows) {
      const ts = typeof row.t === "number" ? row.t : Date.parse(row.t);
      const key =
        mode === "perhop"
          ? multiNode
            ? `${row.node} · ${row.hop}`
            : `${row.hop}`
          : multiNode
            ? row.node
            : "loss";
      seriesKeys.add(key);
      let bucketRow = buckets.get(ts);
      if (!bucketRow) {
        bucketRow = { t: ts };
        buckets.set(ts, bucketRow);
      }
      bucketRow[key] = row.loss;
    }

    const data = Array.from(buckets.values()).sort(
      (a, b) => (a.t as number) - (b.t as number),
    );

    return NextResponse.json({
      data,
      series: Array.from(seriesKeys).sort(),
      mode,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "query failed" },
      { status: 502 },
    );
  }
}
