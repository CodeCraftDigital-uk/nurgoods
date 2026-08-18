set -e
SEC=$(cd /dev-server && bun -e '
import { resolveShopifyCredentials } from "@/lib/services/shopify.server";
const r = await resolveShopifyCredentials();
process.stdout.write(r.clientSecret ?? "");
')
cd /tmp/shopdeploy/app
CI=1 SHOPIFY_CLI_PARTNERS_TOKEN="$SEC" timeout 240 npx --yes @shopify/cli@latest app deploy --allow-updates --no-color 2>&1 | tail -20
