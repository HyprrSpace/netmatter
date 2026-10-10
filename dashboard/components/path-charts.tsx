import * as React from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { THRESHOLDS, fmtMs, fmtPct } from "@/lib/health";
import { nodeColor } from "@/lib/palette";
import type { PathDetail } from "@/lib/types";

type Row = Record<string, number | [number, number] | undefined> & { t: number };

// Fill holes of up to this many buckets by interpolation — a late probe, not
// an outage. Longer holes stay empty so a dead agent shows as a gap.
const MAX_FILL = 2;

function buildRows(detail: PathDetail, nodes: string[]) {
  const grid: number[] = [];
  for (let t = detail.start; t <= detail.now; t += detail.bucketMs) grid.push(t);
  const index = new Map(grid.map((t, i) => [t, i]));
  const rows: Row[] = grid.map((t) => ({ t }));

  for (const [i, node] of nodes.entries()) {
    const id = `n${i}`;
    const pts = detail.timeline.filter((p) => p.node === node);
    const present: number[] = [];
    for (const p of pts) {
      const k = index.get(p.t);
      if (k == null) continue;
      Object.assign(rows[k], {
        [`${id}_loss`]: p.loss,
        [`${id}_lossMax`]: p.lossMax,
        [`${id}_rtt`]: p.rtt,
        [`${id}_band`]: [p.best, p.wrst],
        [`${id}_jit`]: p.jitter,
      });
      present.push(k);
    }
    present.sort((a, b) => a - b);
    for (let j = 1; j < present.length; j++) {
      const a = present[j - 1];
      const b = present[j];
      if (b - a <= 1 || b - a - 1 > MAX_FILL) continue;
      for (let k = a + 1; k < b; k++) {
        const f = (k - a) / (b - a);
        for (const key of ["loss", "rtt"]) {
          const va = rows[a][`${id}_${key}`] as number;
          const vb = rows[b][`${id}_${key}`] as number;
          rows[k][`${id}_${key}`] = va + (vb - va) * f;
        }
      }
    }
  }
  return rows;
}

export function NodeLegend({
  nodes,
  allNodes,
  hidden,
  selected,
  onToggle,
}: {
  nodes: string[];
  allNodes: string[];
  hidden: Set<string>;
  selected: string | null;
  onToggle: (node: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {nodes.map((n) => (
        <button
          key={n}
          aria-pressed={!hidden.has(n)}
          onClick={() => onToggle(n)}
          title={hidden.has(n) ? `Show ${n}` : `Hide ${n}`}
          className={cn(
            "matte inline-flex h-7 items-center gap-2 rounded-full px-2.5 font-mono text-xs",
            hidden.has(n) && "text-muted-foreground line-through decoration-white/30",
            n === selected && "border-white/25",
          )}
        >
          <span
            className="size-2 rounded-full"
            style={{ background: hidden.has(n) ? "transparent" : nodeColor(allNodes, n), boxShadow: `inset 0 0 0 1.5px ${nodeColor(allNodes, n)}` }}
          />
          {n}
        </button>
      ))}
    </div>
  );
}

export function PathCharts({
  detail,
  nodes,
  allNodes,
  hidden,
  selected,
}: {
  detail: PathDetail;
  nodes: string[];
  allNodes: string[];
  hidden: Set<string>;
  selected: string | null;
}) {
  const rows = React.useMemo(() => buildRows(detail, nodes), [detail, nodes]);
  const visible = nodes.map((n, i) => ({ n, id: `n${i}`, color: nodeColor(allNodes, n) })).filter((s) => !hidden.has(s.n));

  const config = React.useMemo<ChartConfig>(
    () => Object.fromEntries(nodes.map((n, i) => [`n${i}`, { label: n, color: nodeColor(allNodes, n) }])),
    [nodes, allNodes],
  );

  const lossPeak = Math.max(
    0,
    ...rows.flatMap((r) => visible.map((s) => (r[`${s.id}_loss`] as number | undefined) ?? 0)),
  );
  const lossTop = [5, 10, 25, 50, 100].find((v) => v >= lossPeak * 1.1) ?? 100;
  const single = visible.length === 1 ? visible[0] : null;

  const span = detail.now - detail.start;
  const timeFmt = (t: number) => {
    const d = new Date(t);
    return span > 20 * 3600e3
      ? d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })
      : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const xAxis = (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={[detail.start, detail.now]}
      tickFormatter={timeFmt}
      tickLine={false}
      axisLine={false}
      minTickGap={48}
      tickMargin={8}
      fontSize={11}
    />
  );

  const strokeFor = (n: string) => (selected && n !== selected && visible.length > 1 ? 1.25 : 2);
  const opacityFor = (n: string) => (selected && n !== selected && visible.length > 1 ? 0.55 : 1);

  return (
    <div className="space-y-6">
      <ChartBlock
        title="Loss at destination"
        note={`bucketed avg · dashed line = ${THRESHOLDS.lossWarn}% alert threshold`}
      >
        <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
          <ComposedChart data={rows} syncId="path" margin={{ left: 0, right: 8, top: 8 }}>
            <defs>
              {visible.map((s) => (
                <linearGradient key={s.id} id={`fill-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
            {xAxis}
            <YAxis
              domain={[0, lossTop]}
              ticks={[0, lossTop / 5, (2 * lossTop) / 5, (3 * lossTop) / 5, (4 * lossTop) / 5, lossTop]}
              tickFormatter={(v) => `${v}%`}
              tickLine={false}
              axisLine={false}
              width={44}
              fontSize={11}
            />
            <ReferenceLine y={THRESHOLDS.lossWarn} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" />
            <ChartTooltip
              cursor={{ stroke: "rgba(255,255,255,0.25)" }}
              content={<SeriesTooltip series={visible} kind="loss" />}
            />
            {visible.map((s) => (
              <Area
                key={s.id}
                dataKey={`${s.id}_loss`}
                type="monotone"
                stroke={s.color}
                strokeWidth={strokeFor(s.n)}
                strokeOpacity={opacityFor(s.n)}
                fill={`url(#fill-${s.id})`}
                fillOpacity={opacityFor(s.n)}
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
              />
            ))}
          </ComposedChart>
        </ChartContainer>
      </ChartBlock>

      <ChartBlock
        title="Round-trip time, ms"
        note={single ? `${single.n}: avg line, best–worst band` : "avg RTT per node · show one node for its best–worst band"}
      >
        <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
          <ComposedChart data={rows} syncId="path" margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
            {xAxis}
            <YAxis
              tickFormatter={(v) => `${Math.round(v)}`}
              tickLine={false}
              axisLine={false}
              width={44}
              fontSize={11}
              domain={[0, "auto"]}
            />
            <ChartTooltip
              cursor={{ stroke: "rgba(255,255,255,0.25)" }}
              content={<SeriesTooltip series={visible} kind="rtt" />}
            />
            {single && (
              <Area
                dataKey={`${single.id}_band`}
                stroke="none"
                fill={single.color}
                fillOpacity={0.14}
                isAnimationActive={false}
                activeDot={false}
              />
            )}
            {visible.map((s) => (
              <Line
                key={s.id}
                dataKey={`${s.id}_rtt`}
                type="monotone"
                stroke={s.color}
                strokeWidth={strokeFor(s.n)}
                strokeOpacity={opacityFor(s.n)}
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
              />
            ))}
          </ComposedChart>
        </ChartContainer>
      </ChartBlock>
    </div>
  );
}

function ChartBlock({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className="text-sm font-medium">{title}</h4>
        <span className="text-xs text-muted-foreground">{note}</span>
      </div>
      {children}
    </div>
  );
}

function SeriesTooltip({
  active,
  payload,
  series,
  kind,
}: {
  active?: boolean;
  payload?: { payload: Row }[];
  series: { n: string; id: string; color: string }[];
  kind: "loss" | "rtt";
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="min-w-44 rounded-lg border border-white/10 bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="mb-1.5 text-muted-foreground">
        {new Date(row.t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
      </div>
      <div className="grid gap-1">
        {series.map((s) => {
          const main = row[`${s.id}_${kind}`] as number | undefined;
          const band = row[`${s.id}_band`] as [number, number] | undefined;
          const extra =
            kind === "loss"
              ? row[`${s.id}_lossMax`] != null && `peak ${fmtPct(row[`${s.id}_lossMax`] as number)}`
              : band && `± ${(row[`${s.id}_jit`] as number).toFixed(1)} · ${Math.round(band[0])}–${Math.round(band[1])}`;
          return (
            <div key={s.id} className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="font-mono">{s.n}</span>
              <span className="ml-auto pl-3 font-mono tabular-nums">
                {main == null ? (
                  <span className="text-muted-foreground">no data</span>
                ) : kind === "loss" ? (
                  fmtPct(main)
                ) : (
                  fmtMs(main)
                )}
              </span>
              {extra && <span className="font-mono text-muted-foreground tabular-nums">{extra}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
