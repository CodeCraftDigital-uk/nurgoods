import { cn } from "@/lib/utils";
import { brandArt } from "@/lib/brand-assets";

/**
 * Neutral treatment for a product with no synced photography. It is clearly a
 * placeholder, not product imagery: a quiet surface with a small brand mark and
 * a plain line of text. Nothing here implies what the product looks like.
 */
export function MissingProductImage({ className, title }: { className?: string; title?: string }) {
  const label = title?.trim()
    ? `Photography to follow for ${title.trim()}`
    : "Photography to follow for this product";
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-2 bg-secondary/60",
        className,
      )}
    >
      <img src={brandArt("square", "light")} alt={label} className="h-10 w-10 opacity-30" />
      <span className="text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
        Photography to follow
      </span>
    </div>
  );
}
