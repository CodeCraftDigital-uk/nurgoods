import { callAction } from "../../src/lib/zendrop/client.server";
const a = { name: "get_catalog_products", description: "", inputSchema: {}, kind: "read" as const };
const titles = ["Pet Hair Spray Brush","Kemei Professional Hair Clipper Set","Hydrating Collagen Facial Mask","LED Infrared Belt Therapy Device","13-Piece Yoga & Pilates Set","Grip Strengthener Spring Grip Finger Exerciser","Flapping Bird Cat  Toy","Slide And Glide Indoor Soccer Hover Ball for all ages"];
for (const t of titles) {
  const r: any = await callAction(a, { keyword: t, limit: 5 }).catch((e) => ({ err: String(e) }));
  const items = r?.products ?? r?.items ?? r?.data ?? [];
  const names = (Array.isArray(items) ? items : []).map((i: any) => `${i.id}:${i.name ?? i.title}`);
  console.log("###", t, "->", r.err ?? JSON.stringify(names).slice(0, 400));
}
