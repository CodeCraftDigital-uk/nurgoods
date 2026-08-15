import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { LogOut, Menu, X } from "lucide-react";
import { ADMIN_NAV, type NavItem } from "@/lib/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/admin/BrandLogo";

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Platform sections">
      {ADMIN_NAV.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to as "/admin"}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon
              className={cn(
                "h-4 w-4 shrink-0",
                active ? "text-sidebar-primary" : "text-sidebar-foreground/50",
              )}
              aria-hidden="true"
            />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function BrandMark() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <BrandLogo size={32} className="shrink-0 ring-1 ring-sidebar-border/40" />
      <span className="leading-tight">
        <span className="block text-sm font-semibold tracking-[0.16em] text-sidebar-foreground">
          NUR GOODS
        </span>
        <span className="block text-[0.65rem] uppercase tracking-[0.18em] text-sidebar-foreground/55">
          Intelligence
        </span>
      </span>
    </Link>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, isAdmin, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col justify-between bg-sidebar px-4 py-6 lg:flex">
        <div>
          <BrandMark />
          <div className="mt-8">
            <NavList pathname={pathname} />
          </div>
        </div>
        <div className="border-t border-sidebar-border pt-4">
          <p className="truncate text-xs text-sidebar-foreground/60">{user?.email ?? "Signed in"}</p>
          <p className="mt-0.5 text-[0.7rem] uppercase tracking-[0.16em] text-sidebar-foreground/40">
            {isAdmin ? "Admin" : "Limited access"}
          </p>
          <button
            onClick={() => void signOut()}
            className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between bg-sidebar px-4 py-3 lg:hidden">
        <BrandMark />
        <Button
          variant="ghost"
          size="icon"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {open ? <Menu className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close navigation overlay"
            className="absolute inset-0 bg-navy/60"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col justify-between bg-sidebar px-4 py-6">
            <div>
              <div className="flex items-center justify-between">
                <BrandMark />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close navigation"
                  onClick={() => setOpen(false)}
                  className="text-sidebar-foreground hover:bg-sidebar-accent"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <div className="mt-8">
                <NavList pathname={pathname} onNavigate={() => setOpen(false)} />
              </div>
            </div>
            <button
              onClick={() => void signOut()}
              className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground/70"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      ) : null}

      <main className="lg:pl-64">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
          {children}
        </div>
      </main>
    </div>
  );
}
