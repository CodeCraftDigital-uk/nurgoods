import { defineMcp } from "@lovable.dev/mcp-js";
import searchProducts from "./tools/search-products";
import getProduct from "./tools/get-product";
import searchCategories from "./tools/search-categories";
import searchArticles from "./tools/search-articles";
import getArticle from "./tools/get-article";
import getStoreInformation from "./tools/get-store-information";
import getPolicy from "./tools/get-policy";
import getAnswers from "./tools/get-answers";

/**
 * Public, read only connector surface for NUR GOODS.
 *
 * Every tool reads the same publicly published data as the versioned HTTP API
 * under /api/public/v1. There are no write tools, no account data, no order or
 * customer data, and no administrative capability on this surface.
 */
export default defineMcp({
  name: "nur-goods",
  title: "NUR GOODS",
  version: "1.0.0",
  instructions:
    "Read only access to public NUR GOODS knowledge: active store products, categories, published Journal articles, approved answers and published store policies. Checkout, orders, accounts and stock changes are not available here, so send shoppers to the canonical store links returned by these tools. Never state a policy, price or availability that these tools have not returned.",
  tools: [
    searchProducts,
    getProduct,
    searchCategories,
    searchArticles,
    getArticle,
    getStoreInformation,
    getPolicy,
    getAnswers,
  ],
});
