import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDuration } from "@/lib/health";
import { useNow } from "@/lib/use-poll";
import { StatusDot } from "@/components/status";

export const RANGE_OPTIONS = ["15m", "1h", "3h", "6h", "24h", "72h"];

export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="grid-lines absolute inset-0 [mask-image:radial-gradient(ellipse_70%_55%_at_50%_0%,black,transparent_75%)]" />
      <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 bg-[radial-gradient(50%_50%_at_50%_40%,rgba(255,255,255,0.06),transparent_70%)] blur-2xl" />
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        {/* Three hops and a destination. */}
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M4 17 L9 11 L14 14 L20 6" />
          <circle cx="20" cy="6" r="1.6" fill="currentColor" />
        </svg>
      </div>
      <div className="hidden leading-none min-[420px]:block">
        <div className="text-[15px] font-semibold tracking-tight">netmatter</div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">by hyprr</div>
      </div>
    </div>
  );
}

export function Navbar({
  range,
  onRange,
  updatedAt,
  error,
  loading,
  onRefresh,
}: {
  range: string;
  onRange: (r: string) => void;
  updatedAt: number | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const now = useNow();
  return (
    <div className="sticky top-0 z-50 px-4 pt-3 sm:pt-4">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 rounded-full border border-white/10 bg-background/60 py-2 pl-4 pr-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_10px_30px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:pl-5">
        <Logo />
        <div className="flex min-w-0 items-center gap-2">
          <div
            className="hidden items-center gap-2 pr-1 text-xs text-muted-foreground md:flex"
            title={error ?? undefined}
          >
            <StatusDot severity={error ? "crit" : "ok"} pulse />
            {error ? (
              <span className="text-critical">Query failed</span>
            ) : updatedAt ? (
              <span className="tabular-nums">Live · {fmtDuration(now - updatedAt)} ago</span>
            ) : (
              <span>Connecting…</span>
            )}
          </div>
          <div
            role="tablist"
            aria-label="Time range"
            className="flex min-w-0 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-0.5 [scrollbar-width:none]"
          >
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r}
                role="tab"
                aria-selected={r === range}
                onClick={() => onRange(r)}
                className={cn(
                  "h-8 shrink-0 rounded-full px-2.5 font-mono text-xs transition-colors sm:px-3",
                  r === range
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            onClick={onRefresh}
            aria-label="Refresh now"
            className="matte flex size-9 shrink-0 items-center justify-center rounded-full"
          >
            <RefreshCw strokeWidth={1.75} className={cn("size-4", loading && "animate-spin")} />
          </button>
        </div>
      </nav>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="px-4 pb-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 rounded-full border border-white/10 bg-background/60 px-5 py-3 text-xs text-muted-foreground backdrop-blur-xl">
        <span>
          netmatter · mtr from every node, every hop
        </span>
        <a
          href="https://hyprr.cloud"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground transition-opacity hover:opacity-70"
        >
          hyprr<span className="px-0.5 text-foreground/30">//</span>cloud
        </a>
      </div>
    </footer>
  );
}
