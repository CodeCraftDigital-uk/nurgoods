import { Link } from "@tanstack/react-router";
import { JsonLd } from "@/components/public/JsonLd";
import { BRAND } from "@/lib/brand";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Accessible breadcrumb trail plus matching BreadcrumbList schema. Only pass
 * paths that genuinely exist on this site.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const trail: Crumb[] = [{ label: "Home", href: "/" }, ...items];
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: trail.map((crumb, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: crumb.label,
            ...(crumb.href ? { item: `${BRAND.siteUrl}${crumb.href}` } : {}),
          })),
        }}
      />
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-x-1.5">
          {trail.map((crumb, index) => (
            <li key={crumb.label} className="flex items-center gap-x-1.5">
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              {crumb.href && index < trail.length - 1 ? (
                <Link
                  to={crumb.href}
                  className="rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-foreground" aria-current="page">
                  {crumb.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
