import {
  BookOpen,
  Boxes,
  FileText,
  Gauge,
  Inbox,
  LayoutGrid,
  PackageSearch,

  Plug,
  Scale,
  Search,
  ShoppingBag,
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
    to: "/control",
    label: "Dashboard",
    description: "Platform health, onboarding and recent activity.",
    icon: Gauge,
    exact: true,
  },
  {
    to: "/control/catalogue",
    label: "Catalogue Intelligence",
    description: "Synced Shopify products, collections and enrichment coverage.",
    icon: Boxes,
  },
  {
    to: "/control/preview",
    label: "Storefront Preview",
    description: "Internal design preview of the customer product grid.",
    icon: LayoutGrid,
  },
  {
    to: "/control/journal",
    label: "Journal",
    description: "Briefs, drafts, sources, scheduling and publication.",
    icon: BookOpen,
  },
  {
    to: "/control/reviews",
    label: "Reviews",
    description: "Publiko embed code and widget placements.",
    icon: Star,
  },
  {
    to: "/control/seo",
    label: "SEO Intelligence",
    description: "Queries, intent, entities, metadata and schema coverage.",
    icon: Search,
  },
  {
    to: "/control/automations",
    label: "Automations",
    description: "Scheduled jobs, prompt versions and generation runs.",
    icon: Sparkles,
  },
  {
    to: "/control/integrations",
    label: "Integrations",
    description: "Shopify, Zendrop, AI, Publiko and MCP connection state.",
    icon: Plug,
  },
  {
    to: "/control/contact",
    label: "Contact Enquiries",
    description: "Customer support messages received from the storefront.",
    icon: Inbox,
  },
  {
    to: "/control/legal",
    label: "Legal and Trust",
    description: "Policy documents and trust content records.",
    icon: Scale,
  },
  {
    to: "/control/sourcing",
    label: "Sourcing and Pricing",
    description: "Supplier catalogue, margin pricing policy and controlled imports.",
    icon: ShoppingBag,
  },
  {
    to: "/control/intake",
    label: "Product Intake",
    description: "Automated validation, identity, classification and publishing of new products.",
    icon: PackageSearch,
  },
  {
    to: "/control/mcp",

    label: "MCP Readiness",
    description: "Planned read only resources for ChatGPT and Claude.",
    icon: FileText,
  },
];
