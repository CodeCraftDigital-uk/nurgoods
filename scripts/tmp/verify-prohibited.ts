import { getProduct } from "../../src/lib/public-api/queries.server";
import { searchCatalogue } from "../../src/lib/public-api/catalogue-search.server";
console.log("pdp:", await getProduct("silicone-beaded-anal-plug-prostate-massager"));
const r: any = await searchCatalogue({ query: "anal plug", limit: 20 } as any);
console.log("search hits:", (r.items ?? r.products ?? []).length);
