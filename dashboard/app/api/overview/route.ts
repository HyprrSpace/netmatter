import { NextRequest } from "next/server";
import {
  queryInflux,
  finalHopCte,
  parseTime,
  errorResponse,
  RANGES,
} from "@/lib/influx";
import type { Overview, PathSummary } from "@/lib/types";

type AggRow = {
  node: string;
  destination: string;
  runs: number;
  clean: number;
  loss_avg: number | null;
  loss_max: number | null;
  loss_recent: number | null;
  rtt_avg: number | null;
  rtt_recent: number | null;
  jitter: number | null;
  wrst: number | null;
};
type SeenRow = { node: string; destination: string; last_seen: string };
type LatestRow = { node: string; destination: string; hop: string; loss: number };

// Fleet-wide health: one end-to-end summary per node × destination path.
export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get("range") ?? "1h";
  const r = RANGES[range];
  if (!r) return Response.json({ error: "invalid range" }, { status: 400 });

  const inRange = `time > now() - INTERVAL '${r.interval}'`;
  const recent = `time > now() - INTERVAL '10 minutes'`;

  try {
    const [agg, seen, latest] = await Promise.all([
      queryInflux<AggRow>(
        `WITH ${finalHopCte(inRange)}
         SELECT node, destination, count(*) AS runs,
           sum(CASE WHEN loss = 0 THEN 1 ELSE 0 END) AS clean,
           avg(loss) AS loss_avg, max(loss) AS loss_max,
           avg(CASE WHEN ${recent} THEN loss END) AS loss_recent,
           avg("avg") AS rtt_avg,
           avg(CASE WHEN ${recent} THEN "avg" END) AS rtt_recent,
           avg(stdev) AS jitter, max(wrst) AS wrst
         FROM final GROUP BY node, destination`,
      ),
      // Looked up over the full retention window so a node that went silent
      // before the selected range began still shows up (as offline).
      queryInflux<SeenRow>(
        `SELECT node, destination, max(time) AS last_seen FROM mtr
         WHERE time > now() - INTERVAL '72 hours'
         GROUP BY node, destination`,
      ),
      queryInflux<LatestRow>(
        `WITH ${finalHopCte(inRange)}
         SELECT node, destination, hop, loss FROM (
           SELECT node, destination, hop, loss,
             ROW_NUMBER() OVER (PARTITION BY node, destination ORDER BY time DESC) AS r
           FROM final
         ) WHERE r = 1`,
      ),
    ]);

    const key = (row: { node: string; destination: string }) =>
      `${row.node}\u0000${row.destination}`;
    const aggBy = new Map(agg.map((row) => [key(row), row]));
    const latestBy = new Map(latest.map((row) => [key(row), row]));

    const paths: PathSummary[] = seen.map((s) => {
      const a = aggBy.get(key(s));
      const l = latestBy.get(key(s));
      return {
        node: s.node,
        destination: s.destination,
        lastSeen: parseTime(s.last_seen),
        runs: a?.runs ?? 0,
        cleanRuns: a?.clean ?? 0,
        lossAvg: a?.loss_avg ?? null,
        lossMax: a?.loss_max ?? null,
        lossRecent: a?.loss_recent ?? null,
        rttAvg: a?.rtt_avg ?? null,
        rttRecent: a?.rtt_recent ?? null,
        jitter: a?.jitter ?? null,
        wrst: a?.wrst ?? null,
        hops: l ? parseInt(l.hop, 10) : null,
        latestLoss: l?.loss ?? null,
      };
    });

    const body: Overview = {
      now: Date.now(),
      range,
      nodes: [...new Set(paths.map((p) => p.node))].sort(),
      destinations: [...new Set(paths.map((p) => p.destination))].sort(),
      paths,
    };
    return Response.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
