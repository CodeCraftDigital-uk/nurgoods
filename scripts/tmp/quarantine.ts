import { quarantineProhibitedCatalogue } from "../../src/lib/policy/quarantine.server";
const r = await quarantineProhibitedCatalogue();
console.log(JSON.stringify(r, null, 1));
