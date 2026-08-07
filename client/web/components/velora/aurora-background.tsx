import { cn } from "@/lib/utils";

// Velora UI's signature aurora backdrop, installed from its shadcn registry
// (https://velora.colorlib.com/r/aurora-background.json) per design mandate
// §3.5. The component is unmodified; only the --brand-* CSS variables it
// reads are re-themed to the EngiRent Vault palette in globals.css, so the
// drifting-gradient technique matches the Kiosk's animated idle background
// and the two surfaces share one visual language.

interface AuroraBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Overall opacity of the aurora blobs */
  intensity?: "subtle" | "medium" | "vivid";
}

const intensityClass = {
  subtle: "opacity-25 dark:opacity-20",
  medium: "opacity-40 dark:opacity-30",
  vivid: "opacity-60 dark:opacity-45",
};

/**
 * Velora's signature animated aurora backdrop. Absolutely positioned —
 * place inside a `relative overflow-hidden` section.
 */
export function AuroraBackground({
  className,
  intensity = "medium",
  ...props
}: AuroraBackgroundProps) {
  return (
    <div
      aria-hidden
      data-slot="aurora-background"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        intensityClass[intensity],
        className,
      )}
      {...props}
    >
      <div className="animate-aurora-1 absolute -top-1/4 left-[10%] size-[44rem] rounded-full bg-brand-from blur-[120px] will-change-transform" />
      <div className="animate-aurora-2 absolute top-[5%] right-[5%] size-[38rem] rounded-full bg-brand-via blur-[130px] will-change-transform" />
      <div className="animate-aurora-3 absolute -bottom-1/4 left-[35%] size-[40rem] rounded-full bg-brand-to blur-[140px] will-change-transform" />
    </div>
  );
}
