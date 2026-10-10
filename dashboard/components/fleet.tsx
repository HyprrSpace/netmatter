import { ArrowUpRight, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fleetFindings,
  fmtDuration,
  fmtMs,
  fmtPct,
  nodeHealth,
  nodeLastSeen,
  pathHealth,
  type Finding,
} from "@/lib/health";
import type { Overview } from "@/lib/types";
import { SEVERITY_TEXT, StatusChip, StatusDot, StatusIcon } from "@/components/status";

export function StatsStrip({ overview }: { overview: Overview }) {
  const online = overview.nodes.filter((n) => nodeHealth(overview, n) === "ok").length;
  const statuses = overview.paths.map((p) => pathHealth(p, overview.now).severity);
  const healthy = statuses.filter((s) => s === "ok" || s === "info").length;
  const runs = overview.paths.reduce((s, p) => s + p.runs, 0);
  const clean = overview.paths.reduce((s, p) => s + p.cleanRuns, 0);
  const worstPath = overview.paths
    .filter((p) => p.runs > 0)
    .sort((a, b) => (b.lossAvg ?? 0) - (a.lossAvg ?? 0))[0];

  const cells: { label: string; value: React.ReactNode; note: React.ReactNode }[] = [
    {
      label: "Nodes reporting",
      value: (
        <>
          {online}
          <span className="text-muted-foreground">/{overview.nodes.length}</span>
        </>
      ),
      note:
        online === overview.nodes.length ? (
          "all agents live"
        ) : (
          <span className="text-critical">{overview.nodes.length - online} silent</span>
        ),
    },
    {
      label: "Healthy paths",
      value: (
        <>
          {healthy}
          <span className="text-muted-foreground">/{overview.paths.length}</span>
        </>
      ),
      note: `${overview.nodes.length} nodes × ${overview.destinations.length} destinations`,
    },
    {
      label: "Loss-free runs",
      value: runs ? `${((clean / runs) * 100).toFixed(1)}%` : "—",
      note: `${runs.toLocaleString()} runs in ${overview.range}`,
    },
    {
      label: "Worst path loss",
      value: worstPath ? fmtPct(worstPath.lossAvg) : "—",
      note: worstPath ? (
        <span className="truncate font-mono">
          {worstPath.node} → {worstPath.destination}
        </span>
      ) : (
        "no runs"
      ),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 lg:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="min-w-0 bg-background/80 px-5 py-4 backdrop-blur-xl">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {c.label}
          </div>
          <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{c.value}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{c.note}</div>
        </div>
      ))}
    </div>
  );
}

const CELL_TINT = {
  ok: "",
  info: "",
  warn: "border-warning/30 bg-warning/[0.07] hover:border-warning/50",
  crit: "border-critical/40 bg-critical/[0.09] hover:border-critical/60",
} as const;

export function FleetMatrix({
  overview,
  destination,
  node,
  onSelect,
}: {
  overview: Overview;
  destination: string | null;
  node: string | null;
  onSelect: (destination: string, node: string) => void;
}) {
  const byKey = new Map(overview.paths.map((p) => [`${p.node}\u0000${p.destination}`, p]));

  return (
    <div className="glass rounded-2xl p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">End-to-end, node × destination</h3>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          loss · avg RTT ± jitter · click a path to inspect it
        </span>
      </div>
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div
          className="grid min-w-max gap-1.5"
          style={{
            gridTemplateColumns: `minmax(120px,max-content) repeat(${overview.destinations.length}, minmax(132px,1fr))`,
          }}
        >
          <div />
          {overview.destinations.map((d) => (
            <div
              key={d}
              className={cn(
                "truncate px-2 pb-1 font-mono text-xs",
                d === destination ? "text-foreground" : "text-muted-foreground",
              )}
              title={d}
            >
              {d}
            </div>
          ))}

          {overview.nodes.map((n) => {
            const nh = nodeHealth(overview, n);
            const age = overview.now - nodeLastSeen(overview, n);
            return (
              <div key={n} className="contents">
                <div className="flex min-w-0 flex-col justify-center pr-3">
                  <div className="flex items-center gap-2">
                    <StatusDot severity={nh} />
                    <span className="truncate font-mono text-sm">{n}</span>
                  </div>
                  <span className={cn("pl-4 text-[11px]", nh === "ok" ? "text-muted-foreground" : SEVERITY_TEXT[nh])}>
                    {nh === "ok" ? `${fmtDuration(age)} ago` : `silent ${fmtDuration(age)}`}
                  </span>
                </div>
                {overview.destinations.map((d) => {
                  const p = byKey.get(`${n}\u0000${d}`);
                  if (!p) {
                    return (
                      <div
                        key={d}
                        className="no-data flex items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-muted-foreground"
                      >
                        not probed
                      </div>
                    );
                  }
                  const h = pathHealth(p, overview.now);
                  const selected = d === destination && n === node;
                  return (
                    <button
                      key={d}
                      aria-selected={selected}
                      onClick={() => onSelect(d, n)}
                      title={h.reasons.map((r) => r.text).join("\n") || "Healthy"}
                      className={cn(
                        "matte group relative rounded-xl px-3 py-2.5 text-left",
                        CELL_TINT[h.severity],
                        p.runs === 0 && "no-data",
                        selected && "ring-1 ring-white/40",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-lg font-medium tabular-nums leading-6">
                          {p.runs ? fmtPct(p.lossAvg) : "—"}
                        </span>
                        <StatusIcon severity={h.severity} />
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground tabular-nums">
                        {p.runs
                          ? `${fmtMs(p.rttAvg)} ± ${(p.jitter ?? 0).toFixed(1)}`
                          : "no runs in range"}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function FindingsPanel({
  overview,
  onSelect,
}: {
  overview: Overview;
  onSelect: (destination: string | undefined, node: string | undefined) => void;
}) {
  const findings = fleetFindings(overview);
  const counts = { crit: 0, warn: 0, info: 0 };
  for (const f of findings) if (f.severity !== "ok") counts[f.severity]++;

  return (
    <div className="glass flex min-h-0 flex-col rounded-2xl p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Findings</h3>
        <div className="flex gap-1.5">
          {counts.crit > 0 && <StatusChip severity="crit">{counts.crit} critical</StatusChip>}
          {counts.warn > 0 && <StatusChip severity="warn">{counts.warn} degraded</StatusChip>}
          {counts.info > 0 && <StatusChip severity="info">{counts.info} notes</StatusChip>}
        </div>
      </div>
      {findings.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <CircleCheck strokeWidth={1.75} className="size-8 text-success" />
          <p className="text-sm">Every path is healthy</p>
          <p className="text-xs text-muted-foreground">No loss, jitter or silent agents in {overview.range}.</p>
        </div>
      ) : (
        <ul className="-mx-2 max-h-[340px] space-y-0.5 overflow-y-auto">
          {findings.map((f, i) => (
            <FindingRow key={i} finding={f} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FindingRow({
  finding: f,
  onSelect,
}: {
  finding: Finding;
  onSelect: (destination: string | undefined, node: string | undefined) => void;
}) {
  return (
    <li>
      <button
        onClick={() => onSelect(f.destination, f.node)}
        className="group flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.04]"
      >
        <StatusIcon severity={f.severity} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[13px]">{f.title}</span>
          <span className="block text-xs text-muted-foreground">{f.detail}</span>
        </span>
        <ArrowUpRight
          strokeWidth={1.75}
          className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>
    </li>
  );
}
