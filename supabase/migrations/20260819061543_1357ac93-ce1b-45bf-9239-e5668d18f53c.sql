ALTER TABLE public.product_seo_intelligence
  ADD COLUMN IF NOT EXISTS description_sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS entity_summary text,
  ADD COLUMN IF NOT EXISTS identity_findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS regeneration_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_review_reason text,
  ADD COLUMN IF NOT EXISTS identity_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS product_seo_intelligence_state_idx
  ON public.product_seo_intelligence (validation_state);
CREATE INDEX IF NOT EXISTS product_seo_intelligence_analysed_idx
  ON public.product_seo_intelligence (last_analysed_at);