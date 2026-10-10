"use client";

import * as React from "react";
import { DatabaseZap, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SEVERITY_RANK,
  analyzeHops,
  fleetFindings,
  fmtMs,
  fmtPct,
  pathHealth,
  worst,
  type Severity,
} from "@/lib/health";
import type { Overview, PathDetail, PathSummary } from "@/lib/types";
import { usePoll } from "@/lib/use-poll";
import { Backdrop, Footer, Navbar, RANGE_OPTIONS } from "@/components/chrome";
import { FindingsPanel, FleetMatrix, StatsStrip } from "@/components/fleet";
import { NodeLegend, PathCharts } from "@/components/path-charts";
import { HopHeatmap, HopTable } from "@/components/hop-analysis";
import { SectionHeading, StatusDot, StatusIcon } from "@/components/status";
import { Skeleton } from "@/components/ui/skeleton";

export function Dashboard() {
  const [ready, setReady] = React.useState(false);
  const [range, setRange] = React.useState("1h");
  const [destination, setDestination] = React.useState<string | null>(null);
  const [node, setNode] = React.useState<string | null>(null);
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = React.useState(0);

  // The view lives in the URL so a link reproduces it.
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const r = q.get("range");
    if (r && RANGE_OPTIONS.includes(r)) setRange(r);
    setDestination(q.get("destination"));
    setNode(q.get("node"));
    setReady(true);
  }, []);

  React.useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams();
    if (range !== "1h") q.set("range", range);
    if (destination) q.set("destination", destination);
    if (node) q.set("node", node);
    const s = q.toString();
    window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
  }, [ready, range, destination, node]);

  const ov = usePoll<Overview>(ready ? `/api/overview?range=${range}` : null, refreshKey);
  const overview = ov.data;

  // Fall back to the worst destination / node so the inspector opens on the
// problem. A silent agent has nothing to inspect, so staleness doesn't count.
  const activeDest = React.useMemo(() => {
    if (!overview?.destinations.length) return null;
    if (destination && overview.destinations.includes(destination)) return destination;
    return pickWorst(overview.destinations, (d) =>
      overview.paths.filter((p) => p.destination === d),
      overview.now,
    );
  }, [overview, destination]);

  const destNodes = React.useMemo(
    () =>
      overview && activeDest
        ? overview.paths.filter((p) => p.destination === activeDest).map((p) => p.node).sort()
        : [],
    [overview, activeDest],
  );

  const activeNode = React.useMemo(() => {
    if (!overview || !destNodes.length) return null;
    if (node && destNodes.includes(node)) return node;
    return pickWorst(destNodes, (n) => overview.paths.filter((p) => p.node === n && p.destination === activeDest), overview.now);
  }, [overview, destNodes, node, activeDest]);

  const pd = usePoll<PathDetail>(
    activeDest ? `/api/path?destination=${encodeURIComponent(activeDest)}&range=${range}` : null,
    refreshKey,
  );

  const select = (d: string | undefined, n: string | undefined) => {
    if (d) setDestination(d);
    if (n) setNode(n);
    document.getElementById("inspector")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toggleHidden = (n: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  return (
    <>
      <Backdrop />
      <Navbar
        range={range}
        onRange={setRange}
        updatedAt={ov.updatedAt}
        error={ov.error ?? pd.error}
        loading={ov.loading || pd.loading}
        onRefresh={() => setRefreshKey((k) => k + 1)}
      />
      <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-10 sm:pt-14">
        {!overview ? (
          ov.error ? (
            <ErrorState message={ov.error} />
          ) : (
            <LoadingState />
          )
        ) : overview.paths.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <FleetHeader overview={overview} />
            <StatsStrip overview={overview} />
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <FleetMatrix
                overview={overview}
                destination={activeDest}
                node={activeNode}
                onSelect={(d, n) => select(d, n)}
              />
              <FindingsPanel overview={overview} onSelect={select} />
            </div>

            {activeDest && (
              <Inspector
                overview={overview}
                destination={activeDest}
                node={activeNode}
                nodes={destNodes}
                detail={pd.data && !pd.stale ? pd.data : null}
                detailError={pd.error}
                hidden={hidden}
                onToggle={toggleHidden}
                onDestination={setDestination}
                onNode={setNode}
              />
            )}
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

function pickWorst<T>(items: T[], pathsOf: (item: T) => PathSummary[], now: number): T {
  let best = items[0];
  let bestRank = -1;
  for (const item of items) {
    const rank = Math.max(
      0,
      ...pathsOf(item).map((p) => SEVERITY_RANK[pathHealth(p, now, true).severity] * 1000 + (p.lossAvg ?? 0)),
    );
    if (rank > bestRank) {
      best = item;
      bestRank = rank;
    }
  }
  return best;
}

function FleetHeader({ overview }: { overview: Overview }) {
  const findings = fleetFindings(overview);
  const top = findings.reduce<Severity>((s, f) => worst(s, f.severity), "ok");
  const crit = findings.filter((f) => f.severity === "crit").length;
  const warn = findings.filter((f) => f.severity === "warn").length;
  const line =
    crit + warn === 0
      ? "All paths nominal"
      : [crit && `${crit} critical`, warn && `${warn} degraded`].filter(Boolean).join(" · ");

  return (
    <div className="mb-8">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        Fleet health · last {overview.range}
      </p>
      <h1 className="text-balance text-3xl font-semibold leading-[1.05] tracking-tight sm:text-[42px]">
        Every path, every hop. <span className="text-muted-foreground">From every node.</span>
      </h1>
      <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] py-1 pl-2.5 pr-3 text-xs">
        <StatusDot severity={top === "info" ? "ok" : top} />
        <span>{line}</span>
      </div>
    </div>
  );
}

function Inspector({
  overview,
  destination,
  node,
  nodes,
  detail,
  detailError,
  hidden,
  onToggle,
  onDestination,
  onNode,
}: {
  overview: Overview;
  destination: string;
  node: string | null;
  nodes: string[];
  detail: PathDetail | null;
  detailError: string | null;
  hidden: Set<string>;
  onToggle: (n: string) => void;
  onDestination: (d: string) => void;
  onNode: (n: string) => void;
}) {
  const path = overview.paths.find((p) => p.destination === destination && p.node === node) ?? null;
  const diagnosis = React.useMemo(
    () =>
      detail && node
        ? analyzeHops(
            detail.hops.filter((h) => h.node === node),
            detail.runs[node] ?? 0,
          )
        : null,
    [detail, node],
  );

  const destSeverity = (d: string) =>
    overview.paths
      .filter((p) => p.destination === d)
      .reduce<Severity>((s, p) => worst(s, pathHealth(p, overview.now, true).severity), "ok");

  return (
    <section id="inspector" className="scroll-mt-24 pt-16">
      <SectionHeading
        eyebrow="Path inspector"
        lead={<span className="font-mono">{destination}</span>}
        tail={node ? <>from <span className="font-mono">{node}</span></> : undefined}
        sub="End-to-end trend from every node, then hop by hop for the selected one."
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <PillGroup
          label="Destination"
          items={overview.destinations}
          value={destination}
          onChange={onDestination}
          severity={destSeverity}
        />
        <PillGroup
          label="Node"
          items={nodes}
          value={node}
          onChange={onNode}
          severity={(n) => {
            const p = overview.paths.find((x) => x.node === n && x.destination === destination);
            return p ? pathHealth(p, overview.now).severity : "ok";
          }}
        />
      </div>

      {path && <PathKpis path={path} />}

      <div className="glass mt-4 rounded-2xl p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">Timeline</h3>
            <p className="text-xs text-muted-foreground">Final hop per node · hover to compare · click a node to hide it</p>
          </div>
          <NodeLegend nodes={nodes} allNodes={overview.nodes} hidden={hidden} selected={node} onToggle={onToggle} />
        </div>
        {detail ? (
          <PathCharts detail={detail} nodes={nodes} allNodes={overview.nodes} hidden={hidden} selected={node} />
        ) : detailError ? (
          <p className="py-16 text-center text-sm text-critical">{detailError}</p>
        ) : (
          <div className="space-y-6">
            <Skeleton className="h-[240px] w-full bg-white/[0.04]" />
            <Skeleton className="h-[240px] w-full bg-white/[0.04]" />
          </div>
        )}
      </div>

      {node && (
        <div className="glass mt-4 rounded-2xl p-4 sm:p-6">
          <div className="mb-5">
            <h3 className="text-sm font-medium">
              Hop analysis · <span className="font-mono">{node}</span>
            </h3>
            {diagnosis && (
              <div
                className={cn(
                  "mt-3 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm",
                  diagnosis.severity === "crit"
                    ? "border-critical/30 bg-critical/[0.07]"
                    : diagnosis.severity === "warn"
                      ? "border-warning/30 bg-warning/[0.06]"
                      : "border-white/10 bg-white/[0.03]",
                )}
              >
                <StatusIcon severity={diagnosis.severity} className="mt-0.5" />
                <span>{diagnosis.summary}</span>
              </div>
            )}
          </div>
          {detail && diagnosis ? (
            diagnosis.hops.length ? (
              <div className="space-y-8">
                <HopHeatmap detail={detail} node={node} diagnosis={diagnosis} />
                <HopTable diagnosis={diagnosis} />
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {node} has no runs to {destination} in this range.
              </p>
            )
          ) : (
            <Skeleton className="h-[320px] w-full bg-white/[0.04]" />
          )}
        </div>
      )}
    </section>
  );
}

function PillGroup({
  label,
  items,
  value,
  onChange,
  severity,
}: {
  label: string;
  items: string[];
  value: string | null;
  onChange: (v: string) => void;
  severity: (v: string) => Severity;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground sm:w-auto">
        {label}
      </span>
      <div role="tablist" aria-label={label} className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
        {items.map((it) => {
          const s = severity(it);
          return (
            <button
              key={it}
              role="tab"
              aria-selected={it === value}
              onClick={() => onChange(it)}
              className={cn(
                "matte inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3 font-mono text-xs",
                it !== value && "text-muted-foreground",
              )}
            >
              {s !== "ok" && s !== "info" && <StatusDot severity={s} pulse={false} />}
              {it}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PathKpis({ path: p }: { path: PathSummary }) {
  const cells: { label: string; value: string; note: string; tone?: Severity }[] = [
    {
      label: "Loss",
      value: p.runs ? fmtPct(p.lossAvg) : "—",
      note: `peak ${fmtPct(p.lossMax)} · 10m ${fmtPct(p.lossRecent)}`,
      tone: (p.lossAvg ?? 0) >= 5 ? "crit" : (p.lossAvg ?? 0) >= 1 ? "warn" : undefined,
    },
    {
      label: "Avg RTT",
      value: fmtMs(p.rttAvg),
      note: `last 10m ${fmtMs(p.rttRecent)}`,
    },
    {
      label: "Jitter",
      value: fmtMs(p.jitter),
      note: "mean stdev per run",
      tone: (p.jitter ?? 0) >= 10 ? "warn" : undefined,
    },
    {
      label: "Worst RTT",
      value: fmtMs(p.wrst),
      note: p.rttAvg && p.wrst ? `${(p.wrst / p.rttAvg).toFixed(1)}× average` : "—",
    },
    {
      label: "Loss-free runs",
      value: p.runs ? `${((p.cleanRuns / p.runs) * 100).toFixed(1)}%` : "—",
      note: `${p.cleanRuns} of ${p.runs} runs`,
    },
    {
      label: "Path length",
      value: p.hops != null ? `${p.hops} hops` : "—",
      note: "in the latest run",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((c) => (
        <div key={c.label} className="min-w-0 bg-background/80 px-4 py-3.5 backdrop-blur-xl">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">{c.label}</div>
          <div
            className={cn(
              "mt-1 text-xl font-semibold tabular-nums tracking-tight",
              c.tone === "crit" && "text-critical",
              c.tone === "warn" && "text-warning",
            )}
          >
            {c.value}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{c.note}</div>
        </div>
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-2/3 bg-white/[0.05]" />
      <Skeleton className="h-24 w-full rounded-2xl bg-white/[0.04]" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-72 rounded-2xl bg-white/[0.04]" />
        <Skeleton className="h-72 rounded-2xl bg-white/[0.04]" />
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="glass mx-auto mt-10 max-w-xl rounded-2xl p-8 text-center">
      <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-lg border border-critical/30 bg-critical/10">
        <DatabaseZap strokeWidth={1.75} className="size-5 text-critical" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight">Can&apos;t reach InfluxDB</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Check <code className="font-mono text-foreground">INFLUX_HOST</code> and{" "}
        <code className="font-mono text-foreground">INFLUX_TOKEN</code> on the dashboard container.
      </p>
      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-3 text-left font-mono text-xs text-muted-foreground">
        {message}
      </pre>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="glass mx-auto mt-10 max-w-xl rounded-2xl p-8 text-center">
      <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05]">
        <Radar strokeWidth={1.75} className="size-5" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight">No measurements yet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Start an agent on a node and its first mtr run will appear here within a minute or two.
      </p>
      <pre className="mt-4 overflow-x-auto rounded-lg border border-white/10 bg-black/30 p-3 text-left font-mono text-xs text-muted-foreground">
        {`docker run -d --net=host --cap-add=NET_RAW \\
  -e INFLUX_HOST=http://<server>:8181 \\
  -e INFLUX_TOKEN=apiv3_... \\
  -e NODE_NAME=$(hostname) \\
  -e MTR_HOSTS=8.8.8.8,1.1.1.1 \\
  ghcr.io/hyprrspace/netmatter-agent`}
      </pre>
    </div>
  );
}
