import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export function Spinner({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-slate-500",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-8 animate-spin" />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  );
}
