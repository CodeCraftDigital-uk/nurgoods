import {
  BlockStack,
  Button,
  TextBlock,
  reactExtension,
  useSettings,
} from "@shopify/ui-extensions-react/customer-account";
import { createReturnCta } from "./ReturnCta";

const ReturnCta = createReturnCta({ BlockStack, Button, TextBlock, useSettings });

export default reactExtension("customer-account.order-status.block.render", () => <ReturnCta />);
