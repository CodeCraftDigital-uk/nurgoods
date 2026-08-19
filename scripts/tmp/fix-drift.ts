import { runPublicationAudit } from "@/lib/zendrop/publication-audit.server";
const ids = ["gid://shopify/Product/15977583018314","gid://shopify/Product/15977583214922","gid://shopify/Product/15977584951626","gid://shopify/Product/15977585148234"];
const run = await runPublicationAudit({ dryRun: false, limit: 10, shopifyProductIds: ids });
for (const i of run.items) console.log(i.shopifyProductId, i.currentChannels.join("|"), "->", i.desiredChannels.join("|"), i.changed ? "CHANGED" : "no-op", i.message);
console.log("changed", run.changed, "drifted", run.drifted);
