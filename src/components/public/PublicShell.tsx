import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { BrandLogo, BrandWordmark } from "@/components/admin/BrandLogo";
import { BRAND } from "@/lib/brand";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const PRIMARY_NAV = [
  { label: "Shop", to: "/shop" },
  { label: "Collections", to: "/collections" },
  { label: "Journal", to: "/journal" },
  { label: "Reviews", to: "/reviews" },
  { label: "Policies", to: "/legal" },
] as const;

/**
 * Shared frame for every customer facing page. One quiet row of navigation on
 * larger screens, a single menu button on small screens, and generous spacing
 * so the content leads.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <Link to="/" className="flex items-center" aria-label={`${BRAND.name} home`}>
            <BrandWordmark height={28} className="sm:h-9" />
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

            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-input text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:hidden"
                aria-label="Open menu"
              >
                <Menu className="size-5" aria-hidden />
              </SheetTrigger>
              <SheetContent side="right" className="w-[86vw] max-w-sm">
                <SheetHeader className="text-left">
                  <SheetTitle className="sr-only">Menu</SheetTitle>
                  <BrandWordmark height={30} />
                </SheetHeader>
                <nav aria-label="Primary mobile" className="mt-2 flex flex-col px-4 pb-6">
                  {PRIMARY_NAV.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMenuOpen(false)}
                      className="flex min-h-12 items-center border-b border-border/60 font-display text-lg text-foreground"
                      activeProps={{ className: "text-gold" }}
                    >
                      {item.label}
                    </Link>
                  ))}
                  <a
                    href={`mailto:${BRAND.supportEmail}`}
                    className="mt-6 text-sm text-muted-foreground"
                  >
                    {BRAND.supportEmail}
                  </a>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="mt-20 border-t border-border/70">
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 py-14 sm:grid-cols-3 sm:px-8">
          <div>
            <BrandWordmark height={40} />
            <p className="mt-4 font-display text-lg text-foreground">{BRAND.tagline}</p>
          </div>
          <nav aria-label="Footer" className="text-sm">
            <h2 className="text-[0.7rem] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Explore
            </h2>
            <ul className="mt-3 space-y-2.5">
              {PRIMARY_NAV.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="inline-flex min-h-8 items-center text-muted-foreground hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <a
                  href={BRAND.storeUrl}
                  className="inline-flex min-h-8 items-center text-muted-foreground hover:text-foreground"
                >
                  Store
                </a>
              </li>
            </ul>
          </nav>
          <div className="text-sm">
            <h2 className="text-[0.7rem] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Contact
            </h2>
            <ul className="mt-3 space-y-2.5">
              <li>
                <a
                  href={`mailto:${BRAND.supportEmail}`}
                  className="inline-flex min-h-8 items-center text-muted-foreground hover:text-foreground"
                >
                  {BRAND.supportEmail}
                </a>
              </li>
              <li>
                <a
                  href={BRAND.tiktokUrl}
                  className="inline-flex min-h-8 items-center text-muted-foreground hover:text-foreground"
                  rel="me noopener"
                >
                  TikTok {BRAND.tiktokHandle}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border/70">
          <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-5 py-5 sm:px-8">
            <BrandLogo size={24} />
            <p className="text-xs text-muted-foreground">
              {new Date().getFullYear()} {BRAND.name}. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
