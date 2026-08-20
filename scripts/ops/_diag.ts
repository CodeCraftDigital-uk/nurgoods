const m = await import("@/lib/public-api/storefront.server");
try { const f = await m.listStorefrontFacets(); console.log("facets cats", f.categories.length); } catch(e){ console.log("facets ERR", e); }
try { const c = await m.listStorefrontCollections(); console.log("collections", c.length); } catch(e){ console.log("coll ERR", e); }
try { const p = await m.listStorefrontProducts({ limit: 50, offset: 0 }); console.log("products", p.items.length, p.hasMore); } catch(e){ console.log("prod ERR", e); }
const pc = await import("@/lib/services/public-content.functions");
for (const k of ["listPublicArticles","listPublicLegalDocuments","listPublicLegalSources"]) {
  try { const r = await (pc as any)[k]({}); console.log(k, Array.isArray(r)? r.length : typeof r); } catch(e){ console.log(k, "ERR", String(e).slice(0,200)); }
}
