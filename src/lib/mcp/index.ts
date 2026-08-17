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
  version: "1.1.0",
  instructions:
    "Read only shopping connector for the NUR GOODS store (nurgoods.com). Use search_products to find items by keyword, category, product type or tag, and get_product for full details of one product including its images, categories, availability, active variants and current customer facing GBP prices. Prices are in pounds sterling and reflect the live published catalogue. search_categories lists the store categories, search_articles and get_article cover the NUR GOODS Journal, get_policy and get_store_information cover published policies and contact routes, and get_answers returns approved question and answer pairs. Unpublished, draft and unavailable products are never returned. This connector cannot add to a basket, create a checkout, place an order or change anything: always send the shopper to the product_url so they can buy through the normal NUR GOODS checkout. Never state a price, availability or policy that these tools have not returned.",

  // The SDK's tool type does not model exactOptionalPropertyTypes, so the list is
  // asserted to the definition's own tools type.
  tools: [
    searchProducts,
    getProduct,
    searchCategories,
    searchArticles,
    getArticle,
    getStoreInformation,
    getPolicy,
    getAnswers,
  ] as unknown as Parameters<typeof defineMcp>[0]["tools"],
});
