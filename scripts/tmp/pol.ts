import { readStoreChannels, loadPublicationPolicy } from "../../src/lib/zendrop/store-publication.server";
import { resolveRequiredChannels } from "../../src/lib/zendrop/publication-policy";
const p = await loadPublicationPolicy();
const ch = await readStoreChannels();
console.log("policy", p);
console.log("channels", ch.map(c=>c.name));
console.log("required", resolveRequiredChannels(ch, p).map(c=>c.name));
