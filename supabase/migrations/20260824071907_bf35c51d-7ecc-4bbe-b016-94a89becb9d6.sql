ALTER TABLE public.pricing_formula_policy
  ADD COLUMN IF NOT EXISTS activation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS activation_note text;

COMMENT ON COLUMN public.pricing_formula_policy.activation_enabled IS
  'When false the pricing service may correct prices but may never set a product ACTIVE or publish it to a selling channel. Repair and backfill run with this off.';

UPDATE public.pricing_formula_policy
SET activation_enabled = false,
    activation_note = 'Held off during the landed cost pricing repair. Turn on again only when the catalogue is verified on the current formula.'
WHERE activation_enabled IS DISTINCT FROM false;