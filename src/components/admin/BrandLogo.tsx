import { cn } from "@/lib/utils";
import squareLight from "@/assets/square-light.png.asset.json";
import squareDark from "@/assets/square-dark.png.asset.json";
import wordmarkLight from "@/assets/wordmark-light.png.asset.json";
import wordmarkDark from "@/assets/wordmark-dark.png.asset.json";

/**
 * Approved NUR GOODS artwork. Two sets are supplied: the light set (navy
 * letterforms) sits on light surfaces, the dark set (white letterforms) sits on
 * navy or dark surfaces. "auto" follows the active theme.
 */
type Surface = "auto" | "light" | "dark";

function pair(surface: Surface, light: string, dark: string, className: string, alt: string) {
  if (surface === "light") return <img src={light} alt={alt} className={className} loading="eager" />;
  if (surface === "dark") return <img src={dark} alt={alt} className={className} loading="eager" />;
  return (
    <>
      <img src={light} alt={alt} className={cn(className, "dark:hidden")} loading="eager" />
      <img src={dark} alt="" aria-hidden className={cn(className, "hidden dark:block")} loading="eager" />
    </>
  );
}

export function BrandLogo({
  className,
  size = 32,
  surface = "auto",
}: {
  className?: string;
  size?: number;
  surface?: Surface;
}) {
  const cls = cn("h-full w-full object-contain", className);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      {pair(surface, squareLight.url, squareDark.url, cls, "NUR GOODS")}
    </span>
  );
}

export function BrandWordmark({
  className,
  height = 34,
  surface = "auto",
}: {
  className?: string;
  height?: number;
  surface?: Surface;
}) {
  const cls = cn("h-full w-auto object-contain", className);
  return (
    <span className="inline-flex shrink-0 items-center" style={{ height }}>
      {pair(surface, wordmarkLight.url, wordmarkDark.url, cls, "NUR GOODS")}
    </span>
  );
}
