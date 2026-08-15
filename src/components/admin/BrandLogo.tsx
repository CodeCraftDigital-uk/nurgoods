import { cn } from "@/lib/utils";

type BrandLogoProps = {
  className?: string;
  size?: number;
};

/**
 * Typographic NUR GOODS mark. Deliberately letterform only: the approved brand
 * artwork is supplied by the brand owner and dropped in here when available.
 * Nothing is drawn or approximated in its place.
 */
export function BrandLogo({ className, size = 32 }: BrandLogoProps) {
  return (
    <span
      role="img"
      aria-label="NUR GOODS"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-navy font-display text-gold",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
    >
      N
    </span>
  );
}
