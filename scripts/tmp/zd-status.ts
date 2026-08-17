import { getZendropStatus } from "../../src/lib/zendrop/connection.server";
console.log(JSON.stringify(await getZendropStatus(), null, 2));
