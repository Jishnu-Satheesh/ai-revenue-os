import { Badge } from "@/components/ui/badge";

const toneClasses = {
  neutral: "bg-muted text-muted-foreground",
  success: "border-transparent bg-success/12 text-success",
  warning: "border-transparent bg-warning/18 text-foreground",
  danger: "border-transparent bg-danger/12 text-danger",
} as const;

export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: keyof typeof toneClasses;
}) {
  return (
    <Badge variant={tone === "danger" ? "destructive" : "secondary"} className={toneClasses[tone]}>
      {label}
    </Badge>
  );
}
