import { runPublicationAudit, readChannelChecklist } from "../../src/lib/zendrop/publication-audit.server";
console.log("CHECKLIST", JSON.stringify(await readChannelChecklist(), null, 2));
const run = await runPublicationAudit({ dryRun: true, limit: 50 });
console.log("MODE", run.mode, "inspected", run.inspected, "drifted", run.drifted, "changed", run.changed);
console.log("DESIRED", run.desiredChannels);
for (const i of run.items) console.log(i.drifted ? "DRIFT" : "ok  ", i.title, "| on:", i.currentChannels.join("+") || "none", "| unpublish:", i.toUnpublish.join("+") || "-", "| publish:", i.toPublish.join("+") || "-");
