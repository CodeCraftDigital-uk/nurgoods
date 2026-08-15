import {
  BookOpen,
  Boxes,
  FileText,
  Gauge,
  Inbox,
  LayoutGrid,
  Plug,
  Scale,
  Search,
  Sparkles,
  Star,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  exact?: boolean;
}

export const ADMIN_NAV: NavItem[] = [
  {
    to: "/admin",
    label: "Dashboard",
    description: "Platform health, onboarding and recent activity.",
    icon: Gauge,
    exact: true,
  },
  {
    to: "/admin/catalogue",
    label: "Catalogue Intelligence",
    description: "Synced Shopify products, collections and enrichment coverage.",
    icon: Boxes,
  },
  {
    to: "/admin/preview",
    label: "Storefront Preview",
    description: "Internal design preview of the customer product grid.",
    icon: LayoutGrid,
  },
  {
    to: "/admin/journal",
    label: "Journal",
    description: "Briefs, drafts, sources, scheduling and publication.",
    icon: BookOpen,
  },
  {
    to: "/admin/reviews",
    label: "Reviews",
    description: "Publiko embed code and widget placements.",
    icon: Star,
  },
  {
    to: "/admin/seo",
    label: "SEO Intelligence",
    description: "Queries, intent, entities, metadata and schema coverage.",
    icon: Search,
  },
  {
    to: "/admin/automations",
    label: "Automations",
    description: "Scheduled jobs, prompt versions and generation runs.",
    icon: Sparkles,
  },
  {
    to: "/admin/integrations",
    label: "Integrations",
    description: "Shopify, Zendrop, AI, Publiko and MCP connection state.",
    icon: Plug,
  },
  {
    to: "/admin/contact",
    label: "Contact Enquiries",
    description: "Customer support messages received from the storefront.",
    icon: Inbox,
  },
  {
    to: "/admin/legal",
    label: "Legal and Trust",
    description: "Policy documents and trust content records.",
    icon: Scale,
  },

  {
    to: "/admin/mcp",
    label: "MCP Readiness",
    description: "Planned read only resources for ChatGPT and Claude.",
    icon: FileText,
  },
];
