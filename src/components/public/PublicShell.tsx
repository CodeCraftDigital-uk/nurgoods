import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPublicLegalSources } from "@/lib/services/public-content.functions";
import { Menu, Search, LifeBuoy } from "lucide-react";
import { BasketButton, BasketSheet } from "@/components/public/BasketSheet";
import { BrandLogo, BrandWordmark } from "@/components/admin/BrandLogo";
import { BRAND } from "@/lib/brand";
import { ReviewPlacementSlot } from "@/components/public/ReviewPlacementSlot";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const PRIMARY_NAV = [
  { label: "Store", to: "/store" },
  { label: "Collections", to: "/collections" },
  { label: "Journal", to: "/journal" },
  { label: "Reviews", to: "/reviews" },
  { label: "AI Connectors", to: "/ai-connectors" },
  { label: "Policies", to: "/legal" },
  { label: "Contact", to: "/contact" },
] as const;


/** Service facts only. Nothing here is a promise the store has not made. */
const SERVICE_STRIP = [
  "Secure checkout on the NUR GOODS store",
  "Listings read from the live store catalogue",
  `Support from a person at ${BRAND.supportEmail}`,
] as const;

function SearchField({
  id,
  compact = false,
  onSubmitted,
}: {
  id: string;
  compact?: boolean;
  onSubmitted?: () => void;
}) {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = term.trim();
    void navigate({ to: "/store", search: (q ? { q } : {}) as never });
    onSubmitted?.();
  };

  return (
    <form role="search" onSubmit={submit} className="w-full">
      <label htmlFor={id} className="sr-only">
        Search products
      </label>
      <div className="group relative flex w-full items-center">
        <Search
          className="pointer-events-none absolute left-3.5 size-4 text-muted-foreground"
          aria-hidden
        />
        <input
          id={id}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={compact ? "Search products" : "Search the NUR GOODS range"}
          className={`w-full rounded-2xl border border-input bg-surface pl-10 pr-24 text-sm text-foreground shadow-[var(--shadow-card)] outline-none transition-shadow placeholder:text-muted-foreground focus:border-brand focus:ring-4 focus:ring-brand/15 ${
            compact ? "h-11" : "h-12"
          }`}
        />
        <button
          type="submit"
          className="absolute right-1.5 inline-flex h-9 items-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Search
        </button>
      </div>
    </form>
  );
}

/**
 * Shared frame for every customer facing page: a marketplace header with
 * search at its centre, a category row, and a structured commerce footer.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const fetchLegal = useServerFn(listPublicLegalSources);
  // The footer legal list mirrors the documents synced from the store, so it can
  // never drift from the wording that actually applies to an order.
  const legal = useQuery({
    queryKey: ["public-legal-sources"],
    queryFn: () => fetchLegal({}),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const legalLinks = (legal.data ?? []).slice(0, 6);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-6 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:gap-8">
          <Link
            to="/"
            className="flex min-w-0 items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            aria-label={`${BRAND.name} home`}
          >
            {/* Horizontal master at both sizes. 100% larger than prior pass. */}
            <span className="sm:hidden">
              <BrandWordmark treatment="compact" height={52} />
            </span>
            <span className="hidden sm:inline-flex">
              <BrandWordmark height={64} />
            </span>
          </Link>

          <div className="hidden lg:block">
            <SearchField id="header-search" />
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/contact"
              className="hidden min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:inline-flex"
            >
              <LifeBuoy className="size-4" aria-hidden />
              Support
            </Link>
            <BasketButton />

            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-input text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:hidden"
                aria-label="Open menu"
              >
                <Menu className="size-5" aria-hidden />
              </SheetTrigger>
              <SheetContent side="right" className="w-[88vw] max-w-sm">
                <SheetHeader className="text-left">
                  <SheetTitle className="sr-only">Menu</SheetTitle>
                  <BrandWordmark height={28} />
                </SheetHeader>
                <div className="px-4">
                  <SearchField
                    id="menu-search"
                    compact
                    onSubmitted={() => setMenuOpen(false)}
                  />
                </div>
                <nav aria-label="Primary mobile" className="mt-2 flex flex-col px-4 pb-6">
                  {PRIMARY_NAV.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMenuOpen(false)}
                      className="flex min-h-12 items-center border-b border-border/60 font-display text-base font-semibold text-foreground"
                      activeProps={{ className: "text-brand" }}
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

        <div className="border-t border-border/70 px-4 pb-3 sm:px-6 lg:hidden">
          <SearchField id="header-search-mobile" compact />
        </div>

        <div className="hidden border-t border-border/70 lg:block">
          <div className="mx-auto flex w-full max-w-7xl items-center gap-1 px-6">
            <nav aria-label="Primary" className="flex items-center gap-1">
              {PRIMARY_NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="inline-flex min-h-10 items-center rounded-lg px-3 text-[0.82rem] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  activeProps={{ className: "text-brand" }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <div className="border-b border-border/70 bg-brand-soft/60">
        <ul className="mx-auto flex w-full max-w-7xl gap-6 overflow-x-auto px-4 py-2 text-[0.72rem] font-medium text-accent-foreground sm:px-6">
          {SERVICE_STRIP.map((line) => (
            <li key={line} className="flex shrink-0 items-center gap-2">
              <span aria-hidden className="size-1.5 rounded-full bg-gold" />
              {line}
            </li>
          ))}
        </ul>
      </div>

      <BasketSheet />

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="mt-20 border-t border-border/70 bg-surface-muted/60">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-4 sm:px-8">
          <div>
            <BrandWordmark fullWidth />
            <p className="mt-4 font-display text-lg font-semibold text-foreground">
              {BRAND.tagline}
            </p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
              A considered everyday range, listed from the live store and ordered through secure
              store checkout.
            </p>
          </div>
          <nav aria-label="Shopping" className="text-sm">
            <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-foreground">
              Shopping
            </h2>
            <ul className="mt-3 space-y-2.5">
              <li>
                <Link
                  to="/store"
                  className="inline-flex min-h-8 items-center text-muted-foreground hover:text-brand"
                >
                  All products
                </Link>
              </li>
              <li>
                <Link
                  to="/collections"
                  className="inline-flex min-h-8 items-center text-muted-foreground hover:text-brand"
                >
                  Shop by category
                </Link>
              </li>
              <li>
                <Link
                  to="/journal"
                  className="inline-flex min-h-8 items-center text-muted-foreground hover:text-brand"
                >
                  Journal
                </Link>
              </li>
              <li>
                <Link
                  to="/ai-connectors"
                  className="inline-flex min-h-8 items-center text-muted-foreground hover:text-brand"
                >
                  AI Connectors
                </Link>
              </li>
              <li>

                <a
                  href={BRAND.storeUrl}
                  className="inline-flex min-h-8 items-center text-muted-foreground hover:text-brand"
                >
                  Store and checkout
                </a>
              </li>
            </ul>
          </nav>
          <nav aria-label="Help and policies" className="text-sm">
            <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-foreground">
              Help and policies
            </h2>
            <ul className="mt-3 space-y-2.5">
              <li>
                <Link
                  to="/contact"
                  className="inline-flex min-h-8 items-center text-muted-foreground hover:text-brand"
                >
                  Customer support
                </Link>
              </li>
              {legalLinks.map((doc) => (
                <li key={doc.slug}>
                  <Link
                    to="/legal/$slug"
                    params={{ slug: doc.slug }}
                    className="inline-flex min-h-8 items-center text-muted-foreground hover:text-brand"
                  >
                    {doc.title}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  to="/legal"
                  className="inline-flex min-h-8 items-center text-muted-foreground hover:text-brand"
                >
                  All policies
                </Link>
              </li>
            </ul>
          </nav>
          <div className="text-sm">
            <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-foreground">
              About and contact
            </h2>
            <ul className="mt-3 space-y-2.5">
              <li>
                <Link
                  to="/reviews"
                  className="inline-flex min-h-8 items-center text-muted-foreground hover:text-brand"
                >
                  Customer reviews
                </Link>
              </li>
              <li>
                <a
                  href={`mailto:${BRAND.supportEmail}`}
                  className="inline-flex min-h-8 items-center text-muted-foreground hover:text-brand"
                >
                  {BRAND.supportEmail}
                </a>
              </li>
              <li>
                <a
                  href={BRAND.tiktokUrl}
                  className="inline-flex min-h-8 items-center text-muted-foreground hover:text-brand"
                  rel="me noopener"
                >
                  TikTok {BRAND.tiktokHandle}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border/70">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div className="flex items-center gap-3">
              <BrandLogo size={24} />
              <p className="text-xs text-muted-foreground">
                {new Date().getFullYear()} {BRAND.name}. All rights reserved.
              </p>
            </div>
            <ReviewPlacementSlot surface="footer" bare className="max-w-full overflow-x-auto" />
          </div>
        </div>
      </footer>
    </div>
  );
}
