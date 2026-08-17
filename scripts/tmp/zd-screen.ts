import { runSourcingScreen } from "../../src/lib/zendrop/import.server";
const r = await runSourcingScreen({ target: 25 });
console.log(r.funnel);
console.log(r.products.slice(0,5).map(p=>({t:p.title.slice(0,40),score:p.score,out:p.outcome,r:p.reasons.filter((x:any)=>x.outcome!=="pass").map((x:any)=>x.code+":"+x.detail)})));
