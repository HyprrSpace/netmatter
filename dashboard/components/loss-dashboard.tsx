"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { MultiSelect } from "@/components/multi-select";
import type { HopMode } from "@/lib/influx";

// Categorical palette — distinct in light & dark, cycled for overflow.
const PALETTE = [
  "#2563eb", "#e11d48", "#16a34a", "#d97706", "#9333ea", "#0891b2",
  "#db2777", "#65a30d", "#4f46e5", "#ea580c", "#0d9488", "#c026d3",
];

const RANGE_OPTIONS = ["15m", "1h", "3h", "6h", "24h", "72h"];

type Meta = { destinations: string[]; nodes: string[]; hops: string[] };
type SeriesResp = {
  data: Record<string, number>[];
  series: string[];
  mode: HopMode;
};

export function LossDashboard() {
  const [meta, setMeta] = React.useState<Meta>({
    destinations: [],
    nodes: [],
    hops: [],
  });
  const [destination, setDestination] = React.useState("");
  const [range, setRange] = React.useState("1h");
  const [mode, setMode] = React.useState<HopMode>("perhop");
  const [nodes, setNodes] = React.useState<string[]>([]); // [] = all
  const [hops, setHops] = React.useState<string[]>([]); // [] = all
  const [resp, setResp] = React.useState<SeriesResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // 1. Load destinations once.
  React.useEffect(() => {
    fetch("/api/meta")
      .then((r) => r.json())
      .then((m: Meta) => {
        setMeta((prev) => ({ ...prev, destinations: m.destinations }));
        if (m.destinations.length && !destination) {
          setDestination(m.destinations[0]);
        } else if (!m.destinations.length) {
          setLoading(false);
        }
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. When destination changes, load its nodes/hops and reset those filters.
  React.useEffect(() => {
    if (!destination) return;
    fetch(`/api/meta?destination=${encodeURIComponent(destination)}`)
      .then((r) => r.json())
      .then((m: Meta) => {
        setMeta((prev) => ({ ...prev, nodes: m.nodes, hops: m.hops }));
        setNodes([]);
        setHops([]);
      })
      .catch((e) => setError(String(e)));
  }, [destination]);

  // 3. Fetch series whenever any filter changes; refresh every 30s.
  const fetchSeries = React.useCallback(() => {
    if (!destination) return;
    const params = new URLSearchParams({ destination, range, mode });
    if (nodes.length) params.set("nodes", nodes.join(","));
    if (hops.length && mode === "perhop") params.set("hops", hops.join(","));
    setLoading(true);
    fetch(`/api/series?${params}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "request failed");
        return json as SeriesResp;
      })
      .then((json) => {
        setResp(json);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [destination, range, mode, nodes, hops]);

  React.useEffect(() => {
    fetchSeries();
    const id = setInterval(fetchSeries, 30_000);
    return () => clearInterval(id);
  }, [fetchSeries]);

  // Map original series keys → safe ids + colors for the chart config.
  const { chartData, chartConfig, ids } = React.useMemo(() => {
    if (!resp) return { chartData: [], chartConfig: {} as ChartConfig, ids: [] };
    const keyToId = new Map<string, string>();
    const config: ChartConfig = {};
    const idList: string[] = [];
    resp.series.forEach((key, i) => {
      const id = `s${i}`;
      keyToId.set(key, id);
      idList.push(id);
      config[id] = { label: key, color: PALETTE[i % PALETTE.length] };
    });
    const data = resp.data.map((row) => {
      const out: Record<string, number> = { t: row.t };
      for (const [key, id] of keyToId) {
        if (row[key] != null) out[id] = row[key];
      }
      return out;
    });
    return { chartData: data, chartConfig: config, ids: idList };
  }, [resp]);

  const timeFmt = React.useCallback(
    (t: number) => {
      const d = new Date(t);
      if (range === "72h" || range === "24h") {
        return d.toLocaleString([], {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    },
    [range],
  );

  const hasData = chartData.length > 0;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="Destination">
          <Select
            value={destination}
            onValueChange={(v) => v && setDestination(v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {meta.destinations.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Time range">
          <Select value={range} onValueChange={(v) => v && setRange(v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((r) => (
                <SelectItem key={r} value={r}>
                  Last {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Node">
          <MultiSelect
            label="Node"
            options={meta.nodes}
            selected={nodes}
            onChange={setNodes}
          />
        </Field>

        <Field label="Hop mode">
          <Select
            value={mode}
            onValueChange={(v) => v && setMode(v as HopMode)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="perhop">Per hop</SelectItem>
              <SelectItem value="avg">Average all hops</SelectItem>
              <SelectItem value="max">Max all hops</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Hops" className={mode === "perhop" ? "" : "opacity-40"}>
          <MultiSelect
            label="Hops"
            options={mode === "perhop" ? meta.hops : []}
            selected={hops}
            onChange={setHops}
          />
        </Field>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Packet loss over time</CardTitle>
          <CardDescription>
            {destination ? (
              <>
                loss(%) to <span className="font-mono">{destination}</span> ·{" "}
                {mode === "perhop"
                  ? "one filled line per hop"
                  : mode === "max"
                    ? "max loss across hops"
                    : "average loss across hops"}
                {nodes.length ? ` · nodes: ${nodes.join(", ")}` : " · all nodes"}
              </>
            ) : (
              "No data yet"
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="flex h-[420px] items-center justify-center text-center text-sm text-destructive">
              {error}
            </div>
          ) : loading && !resp ? (
            <Skeleton className="h-[420px] w-full" />
          ) : !hasData ? (
            <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">
              No samples in this window.
            </div>
          ) : (
            <ChartContainer config={chartConfig} className="h-[420px] w-full">
              <AreaChart data={chartData} margin={{ left: 4, right: 12, top: 8 }}>
                <defs>
                  {ids.map((id) => (
                    <linearGradient
                      key={id}
                      id={`fill-${id}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor={`var(--color-${id})`}
                        stopOpacity={0.35}
                      />
                      <stop
                        offset="95%"
                        stopColor={`var(--color-${id})`}
                        stopOpacity={0.03}
                      />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={timeFmt}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                  tickMargin={8}
                />
                <YAxis
                  domain={[0, 100]}
                  unit="%"
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickMargin={4}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) =>
                        payload?.[0]
                          ? new Date(
                              payload[0].payload.t,
                            ).toLocaleString()
                          : ""
                      }
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                {ids.map((id) => (
                  <Area
                    key={id}
                    dataKey={id}
                    type="monotone"
                    stroke={`var(--color-${id})`}
                    fill={`url(#fill-${id})`}
                    strokeWidth={2}
                    connectNulls
                    isAnimationActive={false}
                    dot={false}
                  />
                ))}
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
