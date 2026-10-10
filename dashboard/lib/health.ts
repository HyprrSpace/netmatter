// Turns raw MTR aggregates into verdicts: path status, fleet findings, and a
// per-hop diagnosis. Pure functions, shared by every view.
import type { HopStat, Overview, PathSummary } from "@/lib/types";

export type Severity = "ok" | "info" | "warn" | "crit";

export const SEVERITY_RANK: Record<Severity, number> = { ok: 0, info: 1, warn: 2, crit: 3 };

export const worst = (a: Severity, b: Severity) =>
  SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;

export const THRESHOLDS = {
  staleMs: 5 * 60e3, // ~4 missed probe cycles
  offlineMs: 15 * 60e3,
  lossWarn: 1, // % at the destination
  lossCrit: 5,
  burst: 10, // a single run this lossy is worth mentioning
  jitterWarn: 10, // ms of mtr stdev
  rttRiseRatio: 1.5, // last 10 min vs range average
  rttRiseMinMs: 10,
  hopStepMs: 20, // latency added by one hop worth calling out
  presence: 0.9, // hop answered in fewer runs than this → intermittent
};

export type Reason = { severity: Severity; text: string };

export type PathHealth = { severity: Severity; reasons: Reason[] };

export function nodeLastSeen(overview: Overview, node: string): number {
  let last = 0;
  for (const p of overview.paths) if (p.node === node) last = Math.max(last, p.lastSeen);
  return last;
}

export function nodeHealth(overview: Overview, node: string): Severity {
  const age = overview.now - nodeLastSeen(overview, node);
  if (age > THRESHOLDS.offlineMs) return "crit";
  if (age > THRESHOLDS.staleMs) return "warn";
  return "ok";
}

// `ignoreStale` judges only what the measurements say, not whether the agent
// is still reporting — used to pick which path to inspect first.
export function pathHealth(p: PathSummary, now: number, ignoreStale = false): PathHealth {
  const reasons: Reason[] = [];
  const age = ignoreStale ? 0 : now - p.lastSeen;
  if (age > THRESHOLDS.offlineMs) {
    reasons.push({ severity: "crit", text: `No data for ${fmtDuration(age)}` });
  } else if (age > THRESHOLDS.staleMs) {
    reasons.push({ severity: "warn", text: `Last run ${fmtDuration(age)} ago` });
  }

  if (p.runs > 0) {
    const loss = Math.max(p.lossAvg ?? 0, p.lossRecent ?? 0);
    if (p.latestLoss === 100) {
      reasons.push({ severity: "crit", text: "Destination unreachable in latest run" });
    } else if (loss >= THRESHOLDS.lossCrit) {
      reasons.push({ severity: "crit", text: `${fmtPct(loss)} loss at destination` });
    } else if (loss >= THRESHOLDS.lossWarn) {
      reasons.push({ severity: "warn", text: `${fmtPct(loss)} loss at destination` });
    } else if ((p.lossMax ?? 0) >= THRESHOLDS.burst) {
      reasons.push({ severity: "info", text: `Loss burst peaking at ${fmtPct(p.lossMax)}` });
    }

    if ((p.jitter ?? 0) >= THRESHOLDS.jitterWarn) {
      reasons.push({ severity: "warn", text: `High jitter · ${fmtMs(p.jitter)} stdev` });
    }

    if (
      p.rttRecent != null &&
      p.rttAvg != null &&
      p.rttRecent > p.rttAvg * THRESHOLDS.rttRiseRatio &&
      p.rttRecent - p.rttAvg > THRESHOLDS.rttRiseMinMs
    ) {
      reasons.push({
        severity: "warn",
        text: `Latency up to ${fmtMs(p.rttRecent)} (avg ${fmtMs(p.rttAvg)})`,
      });
    }
  }

  const severity = reasons.reduce<Severity>((s, r) => worst(s, r.severity), "ok");
  return { severity, reasons };
}

export type Finding = {
  severity: Severity;
  title: string;
  detail: string;
  node?: string;
  destination?: string;
};

// Fleet-wide list of problems, worst first. A silent agent is reported once
// per node rather than once per destination.
export function fleetFindings(overview: Overview): Finding[] {
  const out: Finding[] = [];
  const silent = new Set<string>();

  for (const node of overview.nodes) {
    const age = overview.now - nodeLastSeen(overview, node);
    if (age > THRESHOLDS.staleMs) {
      silent.add(node);
      out.push({
        severity: age > THRESHOLDS.offlineMs ? "crit" : "warn",
        title: `${node} stopped reporting`,
        detail: `Last run ${fmtDuration(age)} ago — agent down, or it can't reach InfluxDB`,
        node,
      });
    }
  }

  for (const p of overview.paths) {
    const { reasons } = pathHealth(p, overview.now);
    for (const r of reasons) {
      if (silent.has(p.node) && /^No data|^Last run/.test(r.text)) continue;
      out.push({
        severity: r.severity,
        title: `${p.node} → ${p.destination}`,
        detail: r.text,
        node: p.node,
        destination: p.destination,
      });
    }
  }

  // Loss to one destination from every node points away from the nodes.
  for (const d of overview.destinations) {
    const live = overview.paths.filter((p) => p.destination === d && p.runs > 0);
    if (live.length >= 2 && live.every((p) => (p.lossAvg ?? 0) >= THRESHOLDS.lossWarn)) {
      out.push({
        severity: "info",
        title: `${d} is lossy from every node`,
        detail: "Likely at or near the destination, not on your side",
        destination: d,
      });
    }
  }

  return out.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

// ---------------------------------------------------------------------------
// Hop analysis — the MTR rules of thumb, applied mechanically:
// • loss that is NOT carried to later hops is a router rate-limiting ICMP
//   replies to mtr, not real packet loss;
// • loss that starts at hop N and persists to the destination is real, and
//   hop N is where to look;
// • the same goes for latency: a step that later hops keep is real distance
//   or congestion; a spike only on one hop is a slow control plane.

export type HopTag = { severity: Severity; label: string; hint: string };

export type HopAnalysis = {
  n: number;
  host: string;
  alts: { host: string; share: number }[]; // other hosts seen at this hop
  presence: number; // share of runs this hop answered in
  lossAvg: number;
  lossMax: number;
  rtt: number;
  best: number;
  wrst: number;
  jitter: number;
  delta: number | null; // ms added vs the previous answering hop
  tags: HopTag[];
};

export type PathDiagnosis = {
  hops: HopAnalysis[];
  severity: Severity;
  summary: string;
  originHop: number | null;
};

const silentHost = (h: string) => h === "???" || h === "";

export function analyzeHops(rows: HopStat[], runs: number): PathDiagnosis {
  const byN = new Map<number, HopStat[]>();
  for (const r of rows) {
    const list = byN.get(r.n) ?? [];
    list.push(r);
    byN.set(r.n, list);
  }

  const hops: HopAnalysis[] = [...byN.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, list]) => {
      list.sort((a, b) => b.runs - a.runs);
      const total = list.reduce((s, r) => s + r.runs, 0);
      const w = (f: (r: HopStat) => number) =>
        list.reduce((s, r) => s + f(r) * r.runs, 0) / total;
      // Prefer naming a host that answered over "???".
      const primary = list.find((r) => !silentHost(r.host)) ?? list[0];
      return {
        n,
        host: primary.host,
        alts: list
          .filter((r) => r !== primary)
          .map((r) => ({ host: r.host, share: r.runs / total })),
        presence: runs ? Math.min(1, total / runs) : 1,
        lossAvg: w((r) => r.lossAvg),
        lossMax: Math.max(...list.map((r) => r.lossMax)),
        rtt: w((r) => r.rtt),
        best: Math.min(...list.map((r) => r.best)),
        wrst: Math.max(...list.map((r) => r.wrst)),
        jitter: w((r) => r.jitter),
        delta: null,
        tags: [],
      };
    });

  if (!hops.length) {
    return { hops, severity: "ok", summary: "No hops recorded in this window.", originHop: null };
  }

  const final = hops[hops.length - 1];
  const answering = hops.filter((h) => !silentHost(h.host) && h.lossAvg < 100);
  const finalLoss = final.lossAvg;
  const lossy = (v: number) => v >= THRESHOLDS.lossWarn;

  // Latency deltas between consecutive answering hops.
  for (let i = 1; i < answering.length; i++) {
    answering[i].delta = answering[i].rtt - answering[i - 1].rtt;
  }

  // Where does the destination's loss begin? Walk back from the end while
  // every hop still shows at least half of the destination's loss.
  let originHop: number | null = null;
  if (lossy(finalLoss)) {
    const floor = finalLoss * 0.5;
    let k = hops.length - 1;
    while (k > 0) {
      const prev = hops[k - 1];
      if (silentHost(prev.host)) {
        k--;
        continue;
      }
      if (prev.lossAvg >= floor) k--;
      else break;
    }
    originHop = hops[k].n;
  }

  for (const h of hops) {
    const isFinal = h === final;
    if (silentHost(h.host)) {
      h.tags.push({
        severity: isFinal ? "crit" : "info",
        label: "no reply",
        hint: isFinal
          ? "The destination never answered"
          : "Router doesn't answer mtr probes — harmless on its own",
      });
      continue;
    }

    if (originHop != null && h.n === originHop) {
      h.tags.push({
        severity: finalLoss >= THRESHOLDS.lossCrit ? "crit" : "warn",
        label: "loss starts",
        hint: "Loss first appears here and carries through to the destination",
      });
    } else if (originHop != null && h.n > originHop && lossy(h.lossAvg)) {
      if (!isFinal) {
        h.tags.push({ severity: "info", label: "carried", hint: "Loss inherited from an earlier hop" });
      }
    } else if (lossy(h.lossAvg) && !isFinal) {
      h.tags.push({
        severity: "info",
        label: "ICMP rate-limit",
        hint: "Later hops don't show this loss, so traffic passes fine — the router just deprioritises replies to mtr",
      });
    }

    if (h.delta != null && h.delta >= THRESHOLDS.hopStepMs) {
      const later = answering.filter((a) => a.n > h.n);
      const kept = later.length === 0 || Math.min(...later.map((a) => a.rtt)) >= h.rtt - h.delta * 0.5;
      h.tags.push(
        kept
          ? {
              severity: "info",
              label: `+${Math.round(h.delta)} ms`,
              hint: "Latency added here persists to the destination — a long link or congestion",
            }
          : {
              severity: "info",
              label: "slow reply",
              hint: "Only this hop is slow; later hops are faster, so it's the router's reply, not the path",
            },
      );
    }

    if (h.jitter >= THRESHOLDS.jitterWarn) {
      const prev = answering.filter((a) => a.n < h.n).pop();
      if (!prev || prev.jitter < THRESHOLDS.jitterWarn) {
        const reachesEnd = final.jitter >= THRESHOLDS.jitterWarn;
        h.tags.push({
          severity: reachesEnd ? "warn" : "info",
          label: "jitter",
          hint: reachesEnd
            ? "Latency variance starts here and reaches the destination"
            : "Variance here doesn't reach the destination",
        });
      }
    }

    if (h.alts.length) {
      h.tags.push({
        severity: "info",
        label: `${h.alts.length + 1} routes`,
        hint: `Path changed in this window: ${[h.host, ...h.alts.map((a) => a.host)].join(", ")}`,
      });
    }

    if (!isFinal && h.presence < THRESHOLDS.presence) {
      h.tags.push({
        severity: "info",
        label: `seen ${Math.round(h.presence * 100)}%`,
        hint: "This hop is missing from some runs — the route is shifting",
      });
    }
  }

  let summary: string;
  let severity: Severity = "ok";
  if (silentHost(final.host) || finalLoss >= 100) {
    severity = "crit";
    summary = "The destination did not answer — the path is broken or the target drops ICMP.";
  } else if (originHop != null) {
    const origin = hops.find((h) => h.n === originHop)!;
    severity = finalLoss >= THRESHOLDS.lossCrit ? "crit" : "warn";
    summary =
      originHop === final.n
        ? `${fmtPct(finalLoss)} loss appears only at the destination itself — the target or its last link.`
        : `${fmtPct(finalLoss)} end-to-end loss begins at hop ${originHop} (${origin.host}) and carries to the destination.`;
  } else if (hops.some((h) => h.tags.some((t) => t.label === "ICMP rate-limit"))) {
    summary = "Intermediate loss isn't forwarded to later hops — ICMP rate limiting. End-to-end is clean.";
  } else {
    summary = "Clean path — no loss at the destination.";
  }
  if (final.jitter >= THRESHOLDS.jitterWarn) {
    severity = worst(severity, "warn");
    summary += ` Jitter at the destination is ${fmtMs(final.jitter)}.`;
  }

  return { hops, severity, summary, originHop };
}

// ---------------------------------------------------------------------------
// Formatting

export function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v === 0) return "0%";
  if (v < 0.1) return "<0.1%";
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
}

export function fmtMs(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}
