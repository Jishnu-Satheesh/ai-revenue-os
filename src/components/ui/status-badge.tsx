import { cn } from "@/lib/utils";

const toneClasses = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/12 text-success",
  warning: "bg-warning/18 text-foreground",
  danger: "bg-danger/12 text-danger",
} as const;

export function StatusBadge({ label, tone = "neutral" }: { label: string; tone?: keyof typeof toneClasses }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", toneClasses[tone])}>{label}</span>;
}
