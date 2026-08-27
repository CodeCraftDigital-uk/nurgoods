/** Re-imports the corrected store policies and pages into the local mirror. */
import { syncLegalContent } from "@/lib/services/shopify-legal.server";
console.log(JSON.stringify(await syncLegalContent(), null, 2));
