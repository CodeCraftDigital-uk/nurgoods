import markUrl from "@/assets/nurgoods-mark.png";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  className?: string;
  size?: number;
};

export function BrandLogo({ className, size = 32 }: BrandLogoProps) {
  return (
    <img
      src={markUrl}
      alt="NUR GOODS"
      width={size}
      height={size}
      className={cn("rounded-md object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}
