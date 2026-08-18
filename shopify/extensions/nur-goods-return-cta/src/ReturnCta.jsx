import {
  BlockStack,
  Button,
  TextBlock,
  useSettings,
} from "@shopify/ui-extensions-react/checkout";

/**
 * Shared body for the Thank you and Order status blocks.
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

export function ReturnCta() {
  const settings = useSettings();
  const url = resolveStorefrontUrl(settings.storefront_url);
  const label =
    typeof settings.cta_label === "string" && settings.cta_label.trim() !== ""
      ? settings.cta_label.trim()
      : "Continue shopping at NUR GOODS";

  return (
    <BlockStack spacing="base">
      <TextBlock>
        Thank you for your order. Your account, order updates and the rest of the range live at
        nurgoods.com.
      </TextBlock>
      <Button kind="primary" to={url} external>
        {label}
      </Button>
    </BlockStack>
  );
}
