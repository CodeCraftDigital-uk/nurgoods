import { intakeCredentials, shopifyGraphql } from "../../src/lib/services/shopify.server";
const creds = await intakeCredentials();
const q = `query($q:String!){ products(first:5, query:$q){ nodes { id title handle status publishedAt variants(first:20){ nodes { title price availableForSale } } } } }`;
const r: any = await shopifyGraphql(creds, q, { q: "title:*Hologram*" });
console.log(JSON.stringify(r?.products?.nodes, null, 2));
