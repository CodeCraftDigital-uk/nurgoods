
-- ============ ENUMS ============
CREATE TYPE public.sync_status AS ENUM ('pending','synced','stale','error');
CREATE TYPE public.workflow_status AS ENUM ('draft','in_review','scheduled','published','archived');
CREATE TYPE public.workflow_stage AS ENUM ('topic_discovery','brief','research','draft','source_verification','optimisation','internal_links','metadata_schema','approval','scheduling');
CREATE TYPE public.run_status AS ENUM ('queued','running','succeeded','failed','cancelled');
CREATE TYPE public.optimisation_status AS ENUM ('not_started','in_progress','needs_review','optimised');
CREATE TYPE public.seo_target_type AS ENUM ('product','collection','article','page');
CREATE TYPE public.placement_surface AS ENUM ('homepage','product_page','collection_page','cart','article_page','reviews_page');

-- ============ SHOPIFY MIRRORS ============
CREATE TABLE public.shopify_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_product_id text NOT NULL UNIQUE,
  handle text NOT NULL,
  title text NOT NULL,
  product_type text,
  vendor text,
  status text,
  tags text[] NOT NULL DEFAULT '{}',
  featured_image_url text,
  price_min numeric(12,2),
  price_max numeric(12,2),
  currency text,
  variant_count integer NOT NULL DEFAULT 0,
  shopify_updated_at timestamptz,
  sync_status public.sync_status NOT NULL DEFAULT 'pending',
  last_synced_at timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopify_products TO authenticated;
GRANT ALL ON public.shopify_products TO service_role;
ALTER TABLE public.shopify_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage shopify products" ON public.shopify_products FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.shopify_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_collection_id text NOT NULL UNIQUE,
  handle text NOT NULL,
  title text NOT NULL,
  description text,
  image_url text,
  product_count integer NOT NULL DEFAULT 0,
  shopify_updated_at timestamptz,
  sync_status public.sync_status NOT NULL DEFAULT 'pending',
  last_synced_at timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopify_collections TO authenticated;
GRANT ALL ON public.shopify_collections TO service_role;
ALTER TABLE public.shopify_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage shopify collections" ON public.shopify_collections FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.shopify_product_collections (
  product_id uuid NOT NULL REFERENCES public.shopify_products(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES public.shopify_collections(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, collection_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopify_product_collections TO authenticated;
GRANT ALL ON public.shopify_product_collections TO service_role;
ALTER TABLE public.shopify_product_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage product collections" ON public.shopify_product_collections FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ PRODUCT ENRICHMENT ============
CREATE TABLE public.product_enrichment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL UNIQUE REFERENCES public.shopify_products(id) ON DELETE CASCADE,
  status public.workflow_status NOT NULL DEFAULT 'draft',
  summary text,
  long_description text,
  benefits jsonb NOT NULL DEFAULT '[]'::jsonb,
  use_cases jsonb NOT NULL DEFAULT '[]'::jsonb,
  specifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  delivery_information text,
  faqs jsonb NOT NULL DEFAULT '[]'::jsonb,
  care_information text,
  notes text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_enrichment TO authenticated;
GRANT ALL ON public.product_enrichment TO service_role;
ALTER TABLE public.product_enrichment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage product enrichment" ON public.product_enrichment FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ PROMPT VERSIONS ============
CREATE TABLE public.prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  stage public.workflow_stage NOT NULL,
  label text NOT NULL,
  template text NOT NULL,
  provider_hint text,
  model_hint text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prompt_versions TO authenticated;
GRANT ALL ON public.prompt_versions TO service_role;
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage prompt versions" ON public.prompt_versions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ JOURNAL ============
CREATE TABLE public.article_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  target_query text,
  search_intent text,
  audience text,
  angle text,
  outline jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_product_ids uuid[] NOT NULL DEFAULT '{}',
  status public.workflow_status NOT NULL DEFAULT 'draft',
  stage public.workflow_stage NOT NULL DEFAULT 'brief',
  requires_live_research boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.article_briefs TO authenticated;
GRANT ALL ON public.article_briefs TO service_role;
ALTER TABLE public.article_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage article briefs" ON public.article_briefs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id uuid REFERENCES public.article_briefs(id) ON DELETE SET NULL,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  excerpt text,
  body_markdown text NOT NULL DEFAULT '',
  hero_image_url text,
  hero_image_alt text,
  status public.workflow_status NOT NULL DEFAULT 'draft',
  stage public.workflow_stage NOT NULL DEFAULT 'draft',
  meta_title text,
  meta_description text,
  canonical_url text,
  schema_type text NOT NULL DEFAULT 'BlogPosting',
  structured_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  faqs jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  author_name text,
  reading_minutes integer,
  sources_verified boolean NOT NULL DEFAULT false,
  scheduled_for timestamptz,
  published_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.articles TO authenticated;
GRANT SELECT ON public.articles TO anon;
GRANT ALL ON public.articles TO service_role;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage articles" ON public.articles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Published articles are public" ON public.articles FOR SELECT TO anon, authenticated
  USING (status = 'published' AND published_at IS NOT NULL);

CREATE TABLE public.article_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text,
  publisher text,
  author text,
  published_date date,
  accessed_at timestamptz NOT NULL DEFAULT now(),
  excerpt text,
  verified boolean NOT NULL DEFAULT false,
  verification_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.article_sources TO authenticated;
GRANT SELECT ON public.article_sources TO anon;
GRANT ALL ON public.article_sources TO service_role;
ALTER TABLE public.article_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage article sources" ON public.article_sources FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Sources of published articles are public" ON public.article_sources FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.articles a WHERE a.id = article_id AND a.status = 'published' AND a.published_at IS NOT NULL));

CREATE TABLE public.article_internal_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  anchor_text text NOT NULL,
  target_type public.seo_target_type NOT NULL,
  target_reference text NOT NULL,
  rationale text,
  accepted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.article_internal_links TO authenticated;
GRANT ALL ON public.article_internal_links TO service_role;
ALTER TABLE public.article_internal_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage article internal links" ON public.article_internal_links FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ AI RUNS ============
CREATE TABLE public.ai_generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage public.workflow_stage NOT NULL,
  status public.run_status NOT NULL DEFAULT 'queued',
  entity_type text,
  entity_id uuid,
  prompt_version_id uuid REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  provider text,
  model text,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  used_live_research boolean NOT NULL DEFAULT false,
  token_input integer,
  token_output integer,
  cost_usd numeric(12,4),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_generation_runs TO authenticated;
GRANT ALL ON public.ai_generation_runs TO service_role;
ALTER TABLE public.ai_generation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage ai runs" ON public.ai_generation_runs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ REVIEWS ============
CREATE TABLE public.review_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'publiko',
  surface public.placement_surface NOT NULL,
  placement_key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT false,
  widget_reference text,
  embed_snippet text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_placements TO authenticated;
GRANT ALL ON public.review_placements TO service_role;
ALTER TABLE public.review_placements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage review placements" ON public.review_placements FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ SEO ============
CREATE TABLE public.seo_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  entity_type text,
  description text,
  same_as_urls text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seo_entities TO authenticated;
GRANT ALL ON public.seo_entities TO service_role;
ALTER TABLE public.seo_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage seo entities" ON public.seo_entities FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.seo_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type public.seo_target_type NOT NULL,
  target_reference text NOT NULL,
  target_label text,
  target_query text,
  search_intent text,
  secondary_queries text[] NOT NULL DEFAULT '{}',
  entity_ids uuid[] NOT NULL DEFAULT '{}',
  meta_title text,
  meta_description text,
  canonical_url text,
  schema_type text,
  internal_link_targets jsonb NOT NULL DEFAULT '[]'::jsonb,
  optimisation_status public.optimisation_status NOT NULL DEFAULT 'not_started',
  last_reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_reference)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seo_records TO authenticated;
GRANT ALL ON public.seo_records TO service_role;
ALTER TABLE public.seo_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage seo records" ON public.seo_records FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.seo_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seo_record_id uuid NOT NULL REFERENCES public.seo_records(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text,
  source_url text,
  include_in_faq_schema boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seo_questions TO authenticated;
GRANT ALL ON public.seo_questions TO service_role;
ALTER TABLE public.seo_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage seo questions" ON public.seo_questions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ AUTOMATION ============
CREATE TABLE public.automation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  job_type text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  schedule_cron text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_run_at timestamptz,
  last_status public.run_status,
  last_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_run_at timestamptz,
  requires_integration text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_jobs TO authenticated;
GRANT ALL ON public.automation_jobs TO service_role;
ALTER TABLE public.automation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage automation jobs" ON public.automation_jobs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ INTEGRATION SETTINGS ============
CREATE TABLE public.integration_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  value text,
  value_type text NOT NULL DEFAULT 'text',
  is_secret_reference boolean NOT NULL DEFAULT false,
  secret_name text,
  required boolean NOT NULL DEFAULT true,
  help_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_settings TO authenticated;
GRANT ALL ON public.integration_settings TO service_role;
ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage integration settings" ON public.integration_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ LEGAL ============
CREATE TABLE public.legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_key text NOT NULL UNIQUE,
  title text NOT NULL,
  slug text NOT NULL,
  summary text,
  body_markdown text NOT NULL DEFAULT '',
  status public.workflow_status NOT NULL DEFAULT 'draft',
  is_placeholder boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  effective_date date,
  last_reviewed_at timestamptz,
  owner_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_documents TO authenticated;
GRANT ALL ON public.legal_documents TO service_role;
ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage legal documents" ON public.legal_documents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ MCP ============
CREATE TABLE public.mcp_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text NOT NULL,
  access_mode text NOT NULL DEFAULT 'read_only',
  readiness text NOT NULL DEFAULT 'planned',
  backing_tables text[] NOT NULL DEFAULT '{}',
  input_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_notes text,
  blocked_reason text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mcp_resources TO authenticated;
GRANT ALL ON public.mcp_resources TO service_role;
ALTER TABLE public.mcp_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage mcp resources" ON public.mcp_resources FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ TIMESTAMP TRIGGERS ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'shopify_products','shopify_collections','product_enrichment','prompt_versions',
    'article_briefs','articles','article_sources','article_internal_links','ai_generation_runs',
    'review_placements','seo_entities','seo_records','seo_questions','automation_jobs',
    'integration_settings','legal_documents','mcp_resources'
  ]
  LOOP
    EXECUTE format('CREATE TRIGGER set_updated_at_%1$s BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
  END LOOP;
END $$;

-- ============ INDEXES ============
CREATE INDEX idx_articles_status ON public.articles(status, published_at DESC);
CREATE INDEX idx_article_sources_article ON public.article_sources(article_id);
CREATE INDEX idx_article_links_article ON public.article_internal_links(article_id);
CREATE INDEX idx_ai_runs_entity ON public.ai_generation_runs(entity_type, entity_id);
CREATE INDEX idx_seo_records_target ON public.seo_records(target_type, target_reference);
CREATE INDEX idx_seo_questions_record ON public.seo_questions(seo_record_id);
CREATE INDEX idx_enrichment_product ON public.product_enrichment(product_id);

-- ============ CONFIGURATION ROWS (structure only, no business content) ============
INSERT INTO public.review_placements (surface, placement_key, label, description) VALUES
  ('homepage','homepage_trust','Homepage trust section','Reserved slot for the homepage reviews and trust module.'),
  ('product_page','product_reviews','Product page reviews','Reserved slot beneath product content.'),
  ('collection_page','collection_ratings','Collection page ratings','Reserved slot for rating badges on collection cards.'),
  ('cart','cart_reassurance','Cart reassurance','Reserved slot for reassurance content in cart.'),
  ('article_page','article_reviews','Article page reviews','Reserved slot for review content within Journal articles.'),
  ('reviews_page','reviews_page_main','Dedicated reviews page','Reserved slot for the full reviews listing page.');

INSERT INTO public.legal_documents (doc_key, title, slug, summary) VALUES
  ('privacy','Privacy Policy','privacy','Awaiting owner supplied text.'),
  ('cookies','Cookie Policy','cookies','Awaiting owner supplied text.'),
  ('terms','Terms of Service','terms','Awaiting owner supplied text.'),
  ('returns','Returns and Refunds','returns','Awaiting owner supplied text.'),
  ('shipping','Shipping and Delivery','shipping','Awaiting owner supplied text.'),
  ('contact','Contact','contact','Awaiting owner supplied text.'),
  ('about','About','about','Awaiting owner supplied text.'),
  ('accessibility','Accessibility','accessibility','Awaiting owner supplied text.');

INSERT INTO public.mcp_resources (resource_key, label, description, backing_tables, sort_order, blocked_reason) VALUES
  ('search_products','Search products','Search the synced Shopify catalogue by keyword, type and tags.', ARRAY['shopify_products','product_enrichment'], 1, 'Requires Shopify Admin API sync.'),
  ('get_product','Get product','Return one product with enriched description, specifications and FAQs.', ARRAY['shopify_products','product_enrichment'], 2, 'Requires Shopify Admin API sync.'),
  ('search_categories','Search categories','Search synced Shopify collections.', ARRAY['shopify_collections'], 3, 'Requires Shopify Admin API sync.'),
  ('get_buying_guide','Get buying guide','Return a published buying guide article for a category or need.', ARRAY['articles'], 4, 'Requires published Journal content.'),
  ('search_articles','Search articles','Search published Journal articles with sources.', ARRAY['articles','article_sources'], 5, 'Requires published Journal content.'),
  ('get_reviews','Get reviews','Return review summaries for a product or the store.', ARRAY['review_placements'], 6, 'Requires Publiko API details.'),
  ('get_shipping_information','Get shipping information','Return the current shipping and delivery policy.', ARRAY['legal_documents'], 7, 'Requires owner supplied policy text.'),
  ('get_returns_policy','Get returns policy','Return the current returns and refunds policy.', ARRAY['legal_documents'], 8, 'Requires owner supplied policy text.');

INSERT INTO public.automation_jobs (job_key, label, description, job_type, requires_integration) VALUES
  ('shopify_catalogue_sync','Shopify catalogue sync','Pull products and collections from the Shopify Admin API.','sync','shopify'),
  ('topic_discovery','Topic discovery','Identify article topics from catalogue, collections and search demand.','content','ai_provider'),
  ('article_drafting','Article drafting','Generate briefs, research and drafts for approved topics.','content','ai_provider'),
  ('seo_audit','SEO audit sweep','Recheck metadata, canonicals and schema coverage.','seo',NULL),
  ('publish_scheduler','Publishing scheduler','Publish scheduled Journal articles.','publishing',NULL);
