import { createStorefrontCartLines } from "../src/lib/services/shopify-storefront.server";
const lines = process.argv.slice(2).map((a) => { const [v,q]=a.split(":"); return { variantId: v!, quantity: Number(q ?? 1) }; });
console.log(await createStorefrontCartLines({ lines }));
