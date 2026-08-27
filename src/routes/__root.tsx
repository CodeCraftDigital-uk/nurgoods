import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { BasketProvider } from "@/lib/basket/BasketProvider";
import { BRAND } from "@/lib/brand";
import { BRAND_ICONS, BRAND_SOCIAL_IMAGE } from "@/lib/brand-assets";

/** Absolute URL for social crawlers, which reject relative image paths. */
const SOCIAL_IMAGE_URL = `${BRAND.siteUrl}${BRAND_SOCIAL_IMAGE.path}`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "NUR GOODS | Good things, brought to light" },
      {
        name: "description",
        content: "Considered everyday goods from NUR GOODS. Good things, brought to light.",
      },
      { name: "author", content: "NUR GOODS" },
      { property: "og:title", content: "NUR GOODS | Good things, brought to light" },
      {
        property: "og:description",
        content: "Considered everyday goods from NUR GOODS. Good things, brought to light.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "NUR GOODS" },
      { property: "og:locale", content: "en_GB" },
      { property: "og:image", content: SOCIAL_IMAGE_URL },
      { property: "og:image:secure_url", content: SOCIAL_IMAGE_URL },
      { property: "og:image:type", content: BRAND_SOCIAL_IMAGE.type },
      { property: "og:image:width", content: String(BRAND_SOCIAL_IMAGE.width) },
      { property: "og:image:height", content: String(BRAND_SOCIAL_IMAGE.height) },
      { property: "og:image:alt", content: BRAND_SOCIAL_IMAGE.alt },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: SOCIAL_IMAGE_URL },
      { name: "twitter:image:alt", content: BRAND_SOCIAL_IMAGE.alt },
      { name: "theme-color", content: "#001E31" },
      { name: "apple-mobile-web-app-title", content: "NUR GOODS" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "application-name", content: "NUR GOODS" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: BRAND_ICONS.faviconIco, sizes: "any" },
      { rel: "icon", href: BRAND_ICONS.favicon, type: "image/png", sizes: "256x256" },
      { rel: "icon", href: BRAND_ICONS.icon192, type: "image/png", sizes: "192x192" },
      { rel: "icon", href: BRAND_ICONS.icon512, type: "image/png", sizes: "512x512" },
      { rel: "shortcut icon", href: BRAND_ICONS.faviconIco },
      { rel: "apple-touch-icon", href: BRAND_ICONS.appleTouch, sizes: "180x180" },

      { rel: "manifest", href: "/site.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=DM+Sans:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <BasketProvider>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </BasketProvider>
      <Toaster />
    </QueryClientProvider>
  );
}
