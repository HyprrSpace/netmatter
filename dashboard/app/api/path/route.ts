import { NextRequest } from "next/server";
import {
  queryInflux,
  sqlStr,
  finalHopCte,
  bucketExpr,
  parseTime,
  errorResponse,
  RANGES,
} from "@/lib/influx";
import type { PathDetail } from "@/lib/types";

type TimelineRow = {
  t: string;
  node: string;
  loss: number;
  loss_max: number;
  rtt: number;
  best: number;
  wrst: number;
  jitter: number;
};
type HopRow = {
  node: string;
  hop: string;
  runs: number;
  loss_avg: number;
  loss_max: number;
  rtt: number;
  best: number;
  wrst: number;
  jitter: number;
};
type HeatRow = { t: string; node: string; n: string; loss: number; rtt: number };
type RunsRow = { node: string; runs: number };

// Everything the detail view needs for one destination: the end-to-end
// timeline per node, per-hop aggregates, and a hop × time grid.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const destination = p.get("destination");
  const range = p.get("range") ?? "1h";
  const r = RANGES[range];
  if (!destination) {
    return Response.json({ error: "destination is required" }, { status: 400 });
  }
  if (!r) return Response.json({ error: "invalid range" }, { status: 400 });

  const where = `destination = ${sqlStr(destination)} AND time > now() - INTERVAL '${r.interval}'`;
  const bucket = bucketExpr(r.bucket);

  try {
    const [timeline, hops, heat, runs] = await Promise.all([
      queryInflux<TimelineRow>(
        `WITH ${finalHopCte(where)}
         SELECT ${bucket} AS t, node,
           avg(loss) AS loss, max(loss) AS loss_max,
           avg("avg") AS rtt, min(best) AS best, max(wrst) AS wrst,
           avg(stdev) AS jitter
         FROM final GROUP BY t, node ORDER BY t`,
      ),
      queryInflux<HopRow>(
        `SELECT node, hop, count(*) AS runs,
           avg(loss) AS loss_avg, max(loss) AS loss_max,
           avg("avg") AS rtt, min(best) AS best, max(wrst) AS wrst,
           avg(stdev) AS jitter
         FROM mtr WHERE ${where} GROUP BY node, hop`,
      ),
      queryInflux<HeatRow>(
        `SELECT ${bucket} AS t, node, split_part(hop, '-', 1) AS n,
           avg(loss) AS loss, avg("avg") AS rtt
         FROM mtr WHERE ${where} GROUP BY t, node, n`,
      ),
      queryInflux<RunsRow>(
        `SELECT node, count(DISTINCT time) AS runs FROM mtr
         WHERE ${where} GROUP BY node`,
      ),
    ]);

    const now = Date.now();
    const body: PathDetail = {
      now,
      range,
      destination,
      start: Math.floor((now - r.ms) / r.bucketMs) * r.bucketMs,
      bucketMs: r.bucketMs,
      timeline: timeline.map((row) => ({
        t: parseTime(row.t),
        node: row.node,
        loss: row.loss,
        lossMax: row.loss_max,
        rtt: row.rtt,
        best: row.best,
        wrst: row.wrst,
        jitter: row.jitter,
      })),
      hops: hops.map((row) => {
        const dash = row.hop.indexOf("-");
        return {
          node: row.node,
          n: parseInt(row.hop.slice(0, dash), 10),
          host: row.hop.slice(dash + 1),
          runs: row.runs,
          lossAvg: row.loss_avg,
          lossMax: row.loss_max,
          rtt: row.rtt,
          best: row.best,
          wrst: row.wrst,
          jitter: row.jitter,
        };
      }),
      heat: heat.map((row) => ({
        t: parseTime(row.t),
        node: row.node,
        n: parseInt(row.n, 10),
        loss: row.loss,
        rtt: row.rtt,
      })),
      runs: Object.fromEntries(runs.map((row) => [row.node, row.runs])),
    };
    return Response.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
