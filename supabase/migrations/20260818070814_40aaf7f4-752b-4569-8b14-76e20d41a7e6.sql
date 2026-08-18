ALTER TABLE public.commerce_webhook_deliveries
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS commerce_webhook_deliveries_status_idx
  ON public.commerce_webhook_deliveries (status, received_at);

DROP TRIGGER IF EXISTS set_updated_at_commerce_webhook_deliveries ON public.commerce_webhook_deliveries;
CREATE TRIGGER set_updated_at_commerce_webhook_deliveries
  BEFORE UPDATE ON public.commerce_webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.commerce_orders
  ADD COLUMN IF NOT EXISTS preview_reference text,
  ADD COLUMN IF NOT EXISTS preview_scope text,
  ADD COLUMN IF NOT EXISTS lines_linked_at timestamptz;