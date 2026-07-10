import { NextRequest, NextResponse } from "next/server";
import { queryInflux, sqlStr } from "@/lib/influx";

// Returns the filter vocabulary: destinations, and (for a chosen destination)
// the nodes and hops seen in the last 72h.
export async function GET(req: NextRequest) {
  const destination = req.nextUrl.searchParams.get("destination");
  try {
    const destinations = await queryInflux<{ destination: string }>(
      `SELECT DISTINCT destination FROM mtr
       WHERE time > now() - INTERVAL '72 hours'
       ORDER BY destination`,
    );

    let nodes: { node: string }[] = [];
    let hops: { hop: string }[] = [];
    if (destination) {
      const where = `destination = ${sqlStr(destination)} AND time > now() - INTERVAL '72 hours'`;
      [nodes, hops] = await Promise.all([
        queryInflux<{ node: string }>(
          `SELECT DISTINCT node FROM mtr WHERE ${where} ORDER BY node`,
        ),
        queryInflux<{ hop: string }>(
          `SELECT DISTINCT hop FROM mtr WHERE ${where} ORDER BY hop`,
        ),
      ]);
    }

    return NextResponse.json({
      destinations: destinations.map((d) => d.destination),
      nodes: nodes.map((n) => n.node),
      hops: hops.map((h) => h.hop),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "query failed" },
      { status: 502 },
    );
  }
}
