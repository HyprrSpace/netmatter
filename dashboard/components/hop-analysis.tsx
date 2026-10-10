import * as React from "react";
import { cn } from "@/lib/utils";
import { fmtMs, fmtPct, type HopAnalysis, type PathDiagnosis } from "@/lib/health";
import type { PathDetail } from "@/lib/types";
import { StatusChip } from "@/components/status";

type Mode = "loss" | "rtt";

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// Loss: one red hue, √-scaled so 2–5% is already visible. Latency: one blue
// hue showing how far a bucket sits above that hop's own median, so spikes
// stand out instead of every row simply getting darker with distance.
function cellColor(mode: Mode, v: number, rowMedian: number) {
  if (mode === "loss") {
    if (v <= 0) return "rgba(255,255,255,0.045)";
    const a = 0.2 + 0.8 * Math.sqrt(Math.min(v, 100) / 100);
    return `color-mix(in oklch, var(--critical) ${Math.round(a * 100)}%, transparent)`;
  }
  const dev = (v - rowMedian) / Math.max(rowMedian * 0.5, 5);
  if (dev <= 0.1) return "rgba(255,255,255,0.045)";
  const a = 0.15 + 0.85 * Math.min(1, dev);
  return `color-mix(in oklch, var(--info) ${Math.round(a * 100)}%, transparent)`;
}

export function HopHeatmap({
  detail,
  node,
  diagnosis,
}: {
  detail: PathDetail;
  node: string;
  diagnosis: PathDiagnosis;
}) {
  const [mode, setMode] = React.useState<Mode>("loss");
  const [hover, setHover] = React.useState<{ n: number; col: number; x: number; y: number } | null>(null);
  const wrap = React.useRef<HTMLDivElement>(null);

  const grid = React.useMemo(() => {
    const cols: number[] = [];
    for (let t = detail.start; t <= detail.now; t += detail.bucketMs) cols.push(t);
    const colOf = new Map(cols.map((t, i) => [t, i]));
    const cells = new Map<number, ({ loss: number; rtt: number } | undefined)[]>();
    for (const c of detail.heat) {
      if (c.node !== node) continue;
      const i = colOf.get(c.t);
      if (i == null) continue;
      const row = cells.get(c.n) ?? Array(cols.length).fill(undefined);
      row[i] = { loss: c.loss, rtt: c.rtt };
      cells.set(c.n, row);
    }
    const medians = new Map(
      [...cells].map(([n, row]) => [n, median(row.filter(Boolean).map((c) => c!.rtt))]),
    );
    return { cols, cells, medians };
  }, [detail, node]);

  const hopsByN = new Map(diagnosis.hops.map((h) => [h.n, h]));
  const ns = diagnosis.hops.map((h) => h.n);
  const hovered = hover ? grid.cells.get(hover.n)?.[hover.col] : undefined;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">Hop × time</h4>
          <p className="text-xs text-muted-foreground">
            {mode === "loss"
              ? "Where in the path loss appears, and when. Darker = more loss."
              : "RTT above each hop's own median — spot when a hop got slow."}
          </p>
        </div>
        <div role="tablist" className="flex rounded-full border border-white/10 bg-white/[0.03] p-0.5">
          {(["loss", "rtt"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "h-7 rounded-full px-3 text-xs transition-colors",
                mode === m ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "loss" ? "Loss" : "Latency"}
            </button>
          ))}
        </div>
      </div>

      <div ref={wrap} className="relative" onMouseLeave={() => setHover(null)}>
        <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-2 sm:grid-cols-[minmax(0,13rem)_1fr]">
          {ns.map((n) => {
            const h = hopsByN.get(n)!;
            const row = grid.cells.get(n);
            const med = grid.medians.get(n) ?? 0;
            const muted = h.tags.some((t) => t.label === "ICMP rate-limit" || t.label === "no reply");
            const origin = n === diagnosis.originHop;
            return (
              <React.Fragment key={n}>
                <div
                  className={cn(
                    "flex h-[18px] min-w-0 items-center gap-1.5 font-mono text-[11px]",
                    muted ? "text-muted-foreground/70" : "text-muted-foreground",
                    origin && "text-critical",
                  )}
                  title={h.host}
                >
                  <span className="w-4 shrink-0 text-right tabular-nums">{n}</span>
                  <span className="truncate">{h.host}</span>
                </div>
                <div
                  className="grid h-[18px] gap-[2px] py-[1px]"
                  style={{ gridTemplateColumns: `repeat(${grid.cols.length}, minmax(0,1fr))` }}
                >
                  {grid.cols.map((_, i) => {
                    const c = row?.[i];
                    return (
                      <div
                        key={i}
                        onMouseEnter={(e) => {
                          const box = wrap.current!.getBoundingClientRect();
                          const r = e.currentTarget.getBoundingClientRect();
                          setHover({ n, col: i, x: r.left - box.left + r.width / 2, y: r.top - box.top });
                        }}
                        className={cn(
                          "rounded-[3px]",
                          !c && "no-data",
                          hover?.n === n && hover.col === i && "ring-1 ring-white/70",
                        )}
                        style={c ? { background: cellColor(mode, mode === "loss" ? c.loss : c.rtt, med) } : undefined}
                      />
                    );
                  })}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {hover && (
          <div
            className="pointer-events-none absolute z-10 min-w-40 -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur"
            style={{ left: Math.min(Math.max(hover.x, 80), (wrap.current?.clientWidth ?? 0) - 80), top: hover.y - 6 }}
          >
            <div className="text-muted-foreground">
              {new Date(grid.cols[hover.col]).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="mt-0.5 truncate font-mono">
              {hover.n} · {hopsByN.get(hover.n)?.host}
            </div>
            {hovered ? (
              <div className="mt-1 flex gap-3 font-mono tabular-nums">
                <span>loss {fmtPct(hovered.loss)}</span>
                <span>rtt {fmtMs(hovered.rtt)}</span>
              </div>
            ) : (
              <div className="mt-1 text-muted-foreground">no runs in this bucket</div>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground sm:pl-[calc(13rem+0.5rem)]">
        <span>{mode === "loss" ? "0%" : "median"}</span>
        <span
          className="h-2 w-28 rounded-full"
          style={{
            background: `linear-gradient(to right, rgba(255,255,255,0.05), color-mix(in oklch, var(--${mode === "loss" ? "critical" : "info"}) 100%, transparent))`,
          }}
        />
        <span>{mode === "loss" ? "100%" : "+50% or more"}</span>
        <span className="no-data ml-3 inline-block size-3 rounded-[3px] border border-white/10" />
        <span>no runs</span>
      </div>
    </div>
  );
}

function LossBar({ hop, origin }: { hop: HopAnalysis; origin: number | null }) {
  const real = origin != null && hop.n >= origin;
  const w = hop.lossAvg <= 0 ? 0 : Math.max(4, Math.sqrt(Math.min(hop.lossAvg, 100) / 100) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className={cn("w-12 text-right tabular-nums", hop.lossAvg >= 1 && real && "text-critical")}>
        {fmtPct(hop.lossAvg)}
      </span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.06]">
        <span
          className={cn("block h-full rounded-full", real ? "bg-critical" : "bg-white/35")}
          style={{ width: `${w}%` }}
        />
      </span>
    </div>
  );
}

export function HopTable({ diagnosis }: { diagnosis: PathDiagnosis }) {
  const head = "px-2 py-2 text-left font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-muted-foreground";
  const num = "px-2 py-2 text-right font-mono tabular-nums";
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[860px] border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr className="[&>th]:border-b [&>th]:border-white/10">
            <th className={cn(head, "w-8 text-right")}>#</th>
            <th className={head}>Host</th>
            <th className={cn(head, "text-right")}>Loss</th>
            <th className={cn(head, "text-right")}>Peak</th>
            <th className={cn(head, "text-right")}>Avg</th>
            <th className={cn(head, "text-right")}>Best</th>
            <th className={cn(head, "text-right")}>Worst</th>
            <th className={cn(head, "text-right")}>Jitter</th>
            <th className={cn(head, "text-right")}>Δ</th>
            <th className={head}>Verdict</th>
          </tr>
        </thead>
        <tbody>
          {diagnosis.hops.map((h) => {
            const origin = h.n === diagnosis.originHop;
            return (
              <tr
                key={h.n}
                className={cn(
                  "[&>td]:border-b [&>td]:border-white/[0.05] hover:bg-white/[0.025]",
                  origin && "bg-critical/[0.06]",
                )}
              >
                <td className={cn(num, "text-muted-foreground")}>{h.n}</td>
                <td className="max-w-[260px] px-2 py-2 font-mono">
                  <div className="truncate" title={h.host}>{h.host}</div>
                  {h.alts.length > 0 && (
                    <div className="truncate text-[11px] text-muted-foreground" title={h.alts.map((a) => `${a.host} (${Math.round(a.share * 100)}%)`).join("\n")}>
                      also {h.alts.map((a) => `${a.host} ${Math.round(a.share * 100)}%`).join(", ")}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 font-mono">
                  <div className="flex justify-end">
                    <LossBar hop={h} origin={diagnosis.originHop} />
                  </div>
                </td>
                <td className={cn(num, "text-muted-foreground")}>{fmtPct(h.lossMax)}</td>
                <td className={num}>{h.rtt.toFixed(1)}</td>
                <td className={cn(num, "text-muted-foreground")}>{h.best.toFixed(1)}</td>
                <td className={cn(num, "text-muted-foreground")}>{h.wrst.toFixed(1)}</td>
                <td className={num}>{h.jitter.toFixed(1)}</td>
                <td className={cn(num, h.delta != null && h.delta >= 20 ? "text-foreground" : "text-muted-foreground")}>
                  {h.delta == null ? "" : `${h.delta >= 0 ? "+" : ""}${h.delta.toFixed(1)}`}
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-wrap gap-1">
                    {h.tags.map((t) => (
                      <StatusChip key={t.label} severity={t.severity} title={t.hint}>
                        {t.label}
                      </StatusChip>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">
        All times in ms. Hover a verdict for the reasoning. Loss that later hops don&apos;t inherit is a router
        rate-limiting replies to mtr — only loss that reaches the destination affects traffic.
      </p>
    </div>
  );
}
