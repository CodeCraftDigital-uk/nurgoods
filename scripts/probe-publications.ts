import { intakeCredentials, shopifyGraphql } from "../src/lib/services/shopify.server";
const c = await intakeCredentials();
const d: any = await shopifyGraphql(c, `query($id:ID!){ publications(first:25){nodes{id name}} product(id:$id){ title resourcePublicationsV2(first:25){nodes{isPublished publication{id name}}}}}`, { id: process.argv[2] });
console.log(JSON.stringify(d, null, 1));
