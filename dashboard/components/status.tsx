import { CircleCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/health";

export const SEVERITY_TEXT: Record<Severity, string> = {
  ok: "text-success",
  info: "text-info",
  warn: "text-warning",
  crit: "text-critical",
};

const SEVERITY_BG: Record<Severity, string> = {
  ok: "bg-success",
  info: "bg-info",
  warn: "bg-warning",
  crit: "bg-critical",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  ok: "Healthy",
  info: "Note",
  warn: "Degraded",
  crit: "Critical",
};

const ICONS = { ok: CircleCheck, info: Info, warn: TriangleAlert, crit: OctagonAlert };

export function StatusIcon({ severity, className }: { severity: Severity; className?: string }) {
  const Icon = ICONS[severity];
  return (
    <Icon
      strokeWidth={1.75}
      aria-label={SEVERITY_LABEL[severity]}
      className={cn("size-4 shrink-0", SEVERITY_TEXT[severity], className)}
    />
  );
}

export function StatusDot({
  severity,
  pulse = severity === "crit",
  className,
}: {
  severity: Severity;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)}>
      {pulse && (
        <span className={cn("pulse-ring absolute inset-0 rounded-full", SEVERITY_BG[severity])} />
      )}
      <span className={cn("relative inline-flex size-2 rounded-full", SEVERITY_BG[severity])} />
    </span>
  );
}

const CHIP: Record<Severity, string> = {
  ok: "border-success/30 bg-success/10 text-success",
  info: "border-info/25 bg-info/10 text-info",
  warn: "border-warning/30 bg-warning/10 text-warning",
  crit: "border-critical/35 bg-critical/10 text-critical",
};

export function StatusChip({
  severity,
  children,
  title,
}: {
  severity: Severity;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] leading-4",
        CHIP[severity],
      )}
    >
      {children}
    </span>
  );
}

// Section anatomy from the house style: mono eyebrow → two-part heading → sub.
export function SectionHeading({
  eyebrow,
  lead,
  tail,
  sub,
  right,
}: {
  eyebrow: string;
  lead: React.ReactNode;
  tail?: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {eyebrow}
        </p>
        <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-[28px]">
          {lead} {tail && <span className="text-muted-foreground">{tail}</span>}
        </h2>
        {sub && <p className="mt-1.5 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
