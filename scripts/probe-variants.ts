import { checkVariantPurchasability } from "../src/lib/services/shopify-storefront.server";
const ids = process.argv.slice(2);
const r = await checkVariantPurchasability(ids);
console.log("purchasable", [...r.purchasable]);
console.log("refused", [...r.refused]);
