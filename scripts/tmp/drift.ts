import { runPublicationAudit } from "../../src/lib/zendrop/publication-audit.server";
let cursor: string | undefined; let inspected=0, drifted=0; const bad:any[]=[];
for (let i=0;i<8;i++){
  const r:any = await runPublicationAudit({ limit: 50, ...(cursor?{cursor}:{}) } as never);
  inspected += r.inspected; drifted += r.drifted;
  for (const it of r.items) if (it.drifted) bad.push({t:it.title,cur:it.currentChannels,un:it.toUnpublish});
  cursor = r.nextCursor; if (!cursor || r.inspected===0) break;
}
console.log("TOTAL", inspected, "DRIFTED", drifted, JSON.stringify(bad).slice(0,900));
