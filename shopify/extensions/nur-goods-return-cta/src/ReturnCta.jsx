/**
 * Shared body for the Thank you and Order status blocks.
 *
 * The two surfaces are rendered by different Shopify packages: the Thank you
 * page comes from the checkout package and the Order status page from the
 * customer account package. The components are not interchangeable between
 * them, so this module takes them as arguments rather than importing either
 * one, and each entry point passes in its own.
 *
 * The store host that took the payment is not a NUR GOODS shopping surface, so
 * the shopper is offered a clear route back to nurgoods.com. The URL is read
 * from the merchant setting and is only used when it really is our storefront,
 * so a mistyped setting can never send a paying customer somewhere unexpected.
 */
const STOREFRONT_URL = "https://nurgoods.com";
const ALLOWED_HOSTS = ["nurgoods.com", "www.nurgoods.com"];

export function resolveStorefrontUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return STOREFRONT_URL;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return STOREFRONT_URL;
    if (!ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) return STOREFRONT_URL;
    return url.toString();
  } catch {
    return STOREFRONT_URL;
  }
}

export function resolveLabel(value) {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : "Continue shopping at NUR GOODS";
}

/**
 * Builds the block for one surface from that surface's own components.
 *
 * @param {{ BlockStack: any, Button: any, TextBlock: any, useSettings: () => any }} ui
 */
export function createReturnCta(ui) {
  const { BlockStack, Button, TextBlock, useSettings } = ui;

  return function ReturnCta() {
    const settings = useSettings();
    const url = resolveStorefrontUrl(settings.storefront_url);
    const label = resolveLabel(settings.cta_label);

    return (
      <BlockStack spacing="base">
        <TextBlock>
          Your order, order updates and the rest of the range live at nurgoods.com.
        </TextBlock>
        <Button kind="primary" to={url} external>
          {label}
        </Button>
      </BlockStack>
    );
  };
}
