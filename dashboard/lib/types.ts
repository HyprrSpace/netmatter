// Shapes returned by the API routes and consumed by the dashboard.

// End-to-end (final hop) stats for one node → destination path.
export type PathSummary = {
  node: string;
  destination: string;
  lastSeen: number; // ms epoch of the newest run, looked up over 72h
  runs: number; // runs inside the selected range (0 = silent in range)
  cleanRuns: number; // runs with 0% loss at the destination
  lossAvg: number | null;
  lossMax: number | null;
  lossRecent: number | null; // last 10 minutes
  rttAvg: number | null;
  rttRecent: number | null; // last 10 minutes
  jitter: number | null; // mean mtr stdev
  wrst: number | null;
  hops: number | null; // path length of the latest run
  latestLoss: number | null;
};

export type Overview = {
  now: number;
  range: string;
  nodes: string[];
  destinations: string[];
  paths: PathSummary[];
};

// One time bucket of final-hop stats for one node.
export type TimelinePoint = {
  t: number;
  node: string;
  loss: number;
  lossMax: number;
  rtt: number;
  best: number;
  wrst: number;
  jitter: number;
};

// Per-hop aggregate over the range. A hop number can map to several hosts
// when the route changes; each host gets its own row.
export type HopStat = {
  node: string;
  n: number;
  host: string;
  runs: number;
  lossAvg: number;
  lossMax: number;
  rtt: number;
  best: number;
  wrst: number;
  jitter: number;
};

export type HeatCell = { t: number; node: string; n: number; loss: number; rtt: number };

export type PathDetail = {
  now: number;
  range: string;
  destination: string;
  start: number;
  bucketMs: number;
  timeline: TimelinePoint[];
  hops: HopStat[];
  heat: HeatCell[];
  runs: Record<string, number>; // runs per node in range
};
