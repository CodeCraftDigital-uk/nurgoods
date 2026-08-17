import { cn } from "@/lib/utils";
import {
  BRAND_ART,
  BRAND_ART_RATIO,
  type BrandSurface,
  type BrandTreatment,
} from "@/lib/brand-assets";

/**
 * Approved NUR GOODS artwork. Two master sets are supplied: the light set
 * (navy NUR letterforms) sits on light or ivory surfaces, the dark set (white
 * NUR letterforms) sits on navy or dark surfaces. "auto" follows the active
 * theme by rendering both masters and toggling visibility, so no CSS filter is
 * ever used to approximate a variant.
 */
type Surface = BrandSurface;

function Art({
  treatment,
  surface,
  className,
  boxStyle,
  alt,
}: {
  treatment: BrandTreatment;
  surface: Surface;
  className: string;
  boxStyle: React.CSSProperties;
  alt: string;
}) {
  const { light, dark } = BRAND_ART[treatment];
  const common = { className, loading: "eager" as const, decoding: "async" as const };

  return (
    <span className="inline-flex shrink-0 items-center justify-center" style={boxStyle}>
      {surface === "light" ? (
        <img src={light} alt={alt} {...common} />
      ) : surface === "dark" ? (
        <img src={dark} alt={alt} {...common} />
      ) : (
        <>
          <img src={light} alt={alt} {...common} className={cn(className, "dark:hidden")} />
          <img
            src={dark}
            alt=""
            aria-hidden
            {...common}
            className={cn(className, "hidden dark:block")}
          />
        </>
      )}
    </span>
  );
}

/** Square / app / avatar treatment of the master identity. */
export function BrandLogo({
  className,
  size = 32,
  surface = "auto",
}: {
  className?: string;
  size?: number;
  surface?: Surface;
}) {
  return (
    <Art
      treatment="square"
      surface={surface}
      alt="NUR GOODS"
      className={cn("h-full w-full object-contain", className)}
      boxStyle={{ width: size, height: size }}
    />
  );
}

/**
 * Horizontal master wordmark for full headers and footers. Space is reserved
 * from the known aspect ratio so the logo never causes layout shift.
 */
export function BrandWordmark({
  className,
  height = 34,
  surface = "auto",
  treatment = "horizontal",
}: {
  className?: string;
  height?: number;
  surface?: Surface;
  treatment?: BrandTreatment;
}) {
  return (
    <Art
      treatment={treatment}
      surface={surface}
      alt="NUR GOODS"
      className={cn("h-full w-auto max-w-full object-contain", className)}
      boxStyle={{ height, minWidth: Math.round(height * BRAND_ART_RATIO[treatment]) }}
    />
  );
}
