import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BrandLogo, BrandWordmark } from "@/components/admin/BrandLogo";
import { BRAND } from "@/lib/brand";

const PRIMARY_NAV = [
  { label: "Shop", to: "/shop" },
  { label: "Collections", to: "/collections" },
  { label: "Journal", to: "/journal" },
  { label: "Reviews", to: "/reviews" },
  { label: "Policies", to: "/legal" },
] as const;

/**
 * Shared frame for every customer facing page. Deliberately quiet: one row of
 * navigation, generous spacing and a single accent line, so content leads.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 py-3 sm:gap-4 sm:px-8">
          <Link to="/" className="flex items-center" aria-label={`${BRAND.name} home`}>
            <BrandWordmark height={30} className="sm:h-9" />
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
              {PRIMARY_NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  activeProps={{ className: "text-foreground" }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <a
              href={BRAND.storeUrl}
              className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-primary px-4 text-[0.82rem] font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:text-sm"
            >
              Store
            </a>
          </div>
        </div>
        <nav
          aria-label="Primary mobile"
          className="flex gap-1 overflow-x-auto border-t border-border/60 px-3 pb-1 md:hidden"
        >
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="inline-flex min-h-11 shrink-0 items-center rounded-md px-2.5 text-[0.82rem] text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "text-foreground" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-20 border-t border-border/70">
        <div className="mx-auto grid w-full max-w-5xl gap-8 px-5 py-12 sm:grid-cols-3 sm:px-8">
          <div>
            <BrandLogo size={72} />
            <p className="mt-3 font-display text-lg text-foreground">{BRAND.tagline}</p>
          </div>
          <nav aria-label="Footer" className="text-sm">
            <p className="text-[0.7rem] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Explore
            </p>
            <ul className="mt-3 space-y-2">
              {PRIMARY_NAV.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className="text-muted-foreground hover:text-foreground">
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <a href={BRAND.storeUrl} className="text-muted-foreground hover:text-foreground">
                  Store
                </a>
              </li>
            </ul>
          </nav>
          <div className="text-sm">
            <p className="text-[0.7rem] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Contact
            </p>
            <ul className="mt-3 space-y-2">
              <li>
                <a
                  href={`mailto:${BRAND.supportEmail}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {BRAND.supportEmail}
                </a>
              </li>
              <li>
                <a
                  href={BRAND.tiktokUrl}
                  className="text-muted-foreground hover:text-foreground"
                  rel="me noopener"
                >
                  TikTok {BRAND.tiktokHandle}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border/70">
          <p className="mx-auto w-full max-w-5xl px-5 py-5 text-xs text-muted-foreground sm:px-8">
            {new Date().getFullYear()} {BRAND.name}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
