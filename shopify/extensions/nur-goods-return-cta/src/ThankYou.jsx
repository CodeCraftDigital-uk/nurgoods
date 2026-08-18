import {
  BlockStack,
  Button,
  TextBlock,
  reactExtension,
  useSettings,
} from "@shopify/ui-extensions-react/checkout";
import { createReturnCta } from "./ReturnCta";

const ReturnCta = createReturnCta({ BlockStack, Button, TextBlock, useSettings });

export default reactExtension("purchase.thank-you.block.render", () => <ReturnCta />);
