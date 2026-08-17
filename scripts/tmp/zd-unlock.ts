import { markOneProductTestPassed, getZendropStatus } from "../../src/lib/zendrop/connection.server";
await markOneProductTestPassed();
const s = await getZendropStatus();
console.log("massImportUnlocked", s.massImportUnlocked, s.testPassedAt);
