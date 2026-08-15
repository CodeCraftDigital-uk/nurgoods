import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/admin/BrandLogo";
import { BRAND } from "@/lib/brand";

const PRIMARY_NAV = [
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
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5" aria-label={`${BRAND.name} home`}>
            <BrandLogo size={34} />
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-foreground">
              {BRAND.name}
            </span>
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
            {PRIMARY_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="inline-flex min-h-11 items-center rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:px-3"
                activeProps={{ className: "text-foreground" }}
              >
                {item.label}
              </Link>
            ))}
            <a
              href={BRAND.storeUrl}
              className="ml-1 inline-flex min-h-11 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:px-4"
            >
              Shop
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-20 border-t border-border/70">
        <div className="mx-auto grid w-full max-w-5xl gap-8 px-5 py-12 sm:grid-cols-3 sm:px-8">
          <div>
            <div className="flex items-center gap-2.5">
              <BrandLogo size={32} />
              <span className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-foreground">
                {BRAND.name}
              </span>
            </div>
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
