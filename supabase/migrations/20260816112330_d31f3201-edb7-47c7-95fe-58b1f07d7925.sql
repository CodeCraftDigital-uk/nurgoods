-- ============ canonical taxonomy ============
CREATE TABLE public.catalogue_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  parent_id uuid REFERENCES public.catalogue_categories(id) ON DELETE SET NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  is_fallback boolean NOT NULL DEFAULT false,
  keywords text[] NOT NULL DEFAULT '{}',
  synonyms text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.catalogue_categories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalogue_categories TO authenticated;
GRANT ALL ON public.catalogue_categories TO service_role;
ALTER TABLE public.catalogue_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enabled categories are public" ON public.catalogue_categories
  FOR SELECT TO anon USING (enabled = true);
CREATE POLICY "Staff read categories" ON public.catalogue_categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage categories" ON public.catalogue_categories
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER catalogue_categories_updated_at BEFORE UPDATE ON public.catalogue_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX catalogue_categories_parent_idx ON public.catalogue_categories(parent_id);

-- ============ classifications ============
CREATE TABLE public.product_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL UNIQUE REFERENCES public.shopify_products(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.catalogue_categories(id) ON DELETE SET NULL,
  category_slug text,
  confidence numeric NOT NULL DEFAULT 0,
  confidence_tier text NOT NULL DEFAULT 'low',
  reasoning text,
  supplier_product_type text,
  supplier_tags text[] NOT NULL DEFAULT '{}',
  supplier_vendor text,
  anomaly_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  quality_score integer NOT NULL DEFAULT 0,
  quality_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  duplicate_of_product_id uuid REFERENCES public.shopify_products(id) ON DELETE SET NULL,
  needs_attention boolean NOT NULL DEFAULT false,
  auto_published boolean NOT NULL DEFAULT false,
  classifier_model text,
  classifier_version text,
  input_fingerprint text,
  last_classified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.product_classifications TO anon;
GRANT SELECT ON public.product_classifications TO authenticated;
GRANT ALL ON public.product_classifications TO service_role;
ALTER TABLE public.product_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Published classifications are public" ON public.product_classifications
  FOR SELECT TO anon USING (auto_published = true);
CREATE POLICY "Staff read classifications" ON public.product_classifications
  FOR SELECT TO authenticated USING (true);
CREATE TRIGGER product_classifications_updated_at BEFORE UPDATE ON public.product_classifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX product_classifications_category_idx ON public.product_classifications(category_id);
CREATE INDEX product_classifications_attention_idx ON public.product_classifications(needs_attention);

-- ============ correction history ============
CREATE TABLE public.product_classification_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.shopify_products(id) ON DELETE CASCADE,
  supplier_category text,
  previous_category_slug text,
  new_category_slug text,
  confidence numeric,
  confidence_tier text,
  reason text,
  source text NOT NULL DEFAULT 'automatic',
  actor uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.product_classification_history TO authenticated;
GRANT ALL ON public.product_classification_history TO service_role;
ALTER TABLE public.product_classification_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read correction history" ON public.product_classification_history
  FOR SELECT TO authenticated USING (true);
CREATE INDEX product_classification_history_product_idx
  ON public.product_classification_history(product_id, created_at DESC);

-- ============ seo intelligence ============
CREATE TABLE public.product_seo_intelligence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL UNIQUE REFERENCES public.shopify_products(id) ON DELETE CASCADE,
  seo_title text,
  meta_description text,
  slug_recommendation text,
  primary_topic text,
  entities text[] NOT NULL DEFAULT '{}',
  keywords text[] NOT NULL DEFAULT '{}',
  image_alt text,
  og_title text,
  og_description text,
  faqs jsonb NOT NULL DEFAULT '[]'::jsonb,
  internal_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  collection_relevance jsonb NOT NULL DEFAULT '[]'::jsonb,
  schema_inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  optimisation_score integer NOT NULL DEFAULT 0,
  validation_state text NOT NULL DEFAULT 'pending',
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_hash text,
  model text,
  intelligence_version text,
  auto_published boolean NOT NULL DEFAULT false,
  last_analysed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.product_seo_intelligence TO anon;
GRANT SELECT ON public.product_seo_intelligence TO authenticated;
GRANT ALL ON public.product_seo_intelligence TO service_role;
ALTER TABLE public.product_seo_intelligence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Validated product seo is public" ON public.product_seo_intelligence
  FOR SELECT TO anon USING (auto_published = true);
CREATE POLICY "Staff read product seo" ON public.product_seo_intelligence
  FOR SELECT TO authenticated USING (true);
CREATE TRIGGER product_seo_intelligence_updated_at BEFORE UPDATE ON public.product_seo_intelligence
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX product_seo_intelligence_state_idx ON public.product_seo_intelligence(validation_state);

-- ============ work queue ============
CREATE TABLE public.intelligence_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.shopify_products(id) ON DELETE CASCADE,
  stage text NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 100,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  locked_at timestamptz,
  lock_token text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX intelligence_queue_open_idx
  ON public.intelligence_queue(product_id, stage)
  WHERE status IN ('queued', 'running');
CREATE INDEX intelligence_queue_status_idx ON public.intelligence_queue(status, priority, created_at);
GRANT SELECT ON public.intelligence_queue TO authenticated;
GRANT ALL ON public.intelligence_queue TO service_role;
ALTER TABLE public.intelligence_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read intelligence queue" ON public.intelligence_queue
  FOR SELECT TO authenticated USING (true);
CREATE TRIGGER intelligence_queue_updated_at BEFORE UPDATE ON public.intelligence_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ taxonomy seed ============
INSERT INTO public.catalogue_categories (slug, name, sort_order, is_fallback, keywords) VALUES
  ('personal-care', 'Personal Care', 10, false, ARRAY['grooming','shaving','hair','skin','body','hygiene','beauty']),
  ('home-and-living', 'Home and Living', 20, false, ARRAY['home','kitchen','bedroom','bathroom','storage','decor','cleaning']),
  ('electronics-and-tech', 'Electronics and Tech', 30, false, ARRAY['electronic','gadget','charger','cable','audio','usb','bluetooth','smart']),
  ('fitness-and-outdoors', 'Fitness and Outdoors', 40, false, ARRAY['fitness','gym','exercise','outdoor','camping','sport','training']),
  ('baby-and-kids', 'Baby and Kids', 50, false, ARRAY['baby','infant','toddler','nursery','child','kids']),
  ('toys-and-games', 'Toys and Games', 60, false, ARRAY['toy','game','puzzle','play','figure','plush']),
  ('pets', 'Pets', 70, false, ARRAY['pet','dog','cat','puppy','kitten','aquarium']),
  ('automotive', 'Automotive', 80, false, ARRAY['car','vehicle','automotive','motorbike','dashboard','windscreen']),
  ('fashion-and-accessories', 'Fashion and Accessories', 90, false, ARRAY['bag','wallet','jewellery','watch','scarf','belt','apparel']),
  ('office-and-stationery', 'Office and Stationery', 100, false, ARRAY['office','desk','stationery','notebook','pen','printer']),
  ('tools-and-diy', 'Tools and DIY', 110, false, ARRAY['tool','drill','repair','diy','workshop','measuring']),
  ('general', 'General', 999, true, ARRAY[]::text[]);

INSERT INTO public.catalogue_categories (slug, name, parent_id, sort_order, keywords)
SELECT v.slug, v.name, p.id, v.sort_order, v.keywords
FROM (VALUES
  ('grooming-and-shaving', 'Grooming and Shaving', 'personal-care', 10, ARRAY['trimmer','shaver','clipper','razor','beard','moustache','stubble','nose hair','epilator','grooming kit','hair removal']),
  ('hair-care', 'Hair Care', 'personal-care', 20, ARRAY['hair dryer','straightener','curler','hair brush','shampoo','scalp','styling']),
  ('skin-care', 'Skin Care', 'personal-care', 30, ARRAY['face','facial','skin','cleanser','moisturiser','serum','mask','pore']),
  ('oral-care', 'Oral Care', 'personal-care', 40, ARRAY['toothbrush','dental','oral','teeth','flosser','tongue']),
  ('wellness-devices', 'Wellness Devices', 'personal-care', 50, ARRAY['massager','massage gun','posture','therapy','relief','acupressure']),
  ('kitchen-and-dining', 'Kitchen and Dining', 'home-and-living', 10, ARRAY['kitchen','cooking','blender','kettle','pan','utensil','dining','mug','bottle opener','food']),
  ('home-organisation', 'Home Organisation', 'home-and-living', 20, ARRAY['storage','organiser','shelf','rack','basket','hanger','drawer']),
  ('bedding-and-bath', 'Bedding and Bath', 'home-and-living', 30, ARRAY['bedding','pillow','duvet','towel','bathroom','shower','mattress']),
  ('lighting', 'Lighting', 'home-and-living', 40, ARRAY['lamp','light','led','bulb','lantern','nightlight']),
  ('cleaning-and-laundry', 'Cleaning and Laundry', 'home-and-living', 50, ARRAY['cleaning','vacuum','mop','laundry','lint','duster','scrubber']),
  ('home-decor', 'Home Decor', 'home-and-living', 60, ARRAY['decor','ornament','vase','frame','wall art','candle','cushion']),
  ('audio', 'Audio', 'electronics-and-tech', 10, ARRAY['headphone','earbud','speaker','microphone','soundbar','earphone']),
  ('phone-accessories', 'Phone Accessories', 'electronics-and-tech', 20, ARRAY['phone case','screen protector','phone holder','phone mount','tripod','selfie']),
  ('charging-and-power', 'Charging and Power', 'electronics-and-tech', 30, ARRAY['charger','power bank','usb','adapter','cable','socket','battery']),
  ('computing-accessories', 'Computing Accessories', 'electronics-and-tech', 40, ARRAY['keyboard','mouse','laptop','monitor','hub','webcam','usb drive']),
  ('wearable-tech', 'Wearable Tech', 'electronics-and-tech', 50, ARRAY['smart watch','fitness tracker','smartwatch','wearable','band']),
  ('smart-home', 'Smart Home', 'electronics-and-tech', 60, ARRAY['smart home','doorbell','security camera','sensor','smart plug']),
  ('fitness-equipment', 'Fitness Equipment', 'fitness-and-outdoors', 10, ARRAY['dumbbell','resistance band','yoga','skipping','ab roller','workout']),
  ('outdoor-and-travel', 'Outdoor and Travel', 'fitness-and-outdoors', 20, ARRAY['camping','hiking','travel','tent','flask','backpack','torch']),
  ('sports-accessories', 'Sports Accessories', 'fitness-and-outdoors', 30, ARRAY['football','cycling','swim','golf','tennis','sports']),
  ('baby-essentials', 'Baby Essentials', 'baby-and-kids', 10, ARRAY['baby bottle','nappy','pram','stroller','teether','bib','infant']),
  ('kids-accessories', 'Kids Accessories', 'baby-and-kids', 20, ARRAY['kids','children','school','lunch box','backpack']),
  ('toys', 'Toys', 'toys-and-games', 10, ARRAY['toy','plush','figure','building block','doll','rc car']),
  ('games-and-puzzles', 'Games and Puzzles', 'toys-and-games', 20, ARRAY['puzzle','board game','card game','brain teaser']),
  ('pet-care', 'Pet Care', 'pets', 10, ARRAY['pet grooming','pet brush','flea','pet nail','pet shampoo']),
  ('pet-accessories', 'Pet Accessories', 'pets', 20, ARRAY['collar','leash','pet bed','pet bowl','pet toy','litter']),
  ('car-accessories', 'Car Accessories', 'automotive', 10, ARRAY['car mount','car charger','seat cover','car organiser','dash cam']),
  ('car-care', 'Car Care', 'automotive', 20, ARRAY['car wash','polish','wax','car vacuum','scratch remover']),
  ('bags-and-wallets', 'Bags and Wallets', 'fashion-and-accessories', 10, ARRAY['bag','wallet','purse','rucksack','tote','pouch']),
  ('jewellery-and-watches', 'Jewellery and Watches', 'fashion-and-accessories', 20, ARRAY['necklace','bracelet','ring','earring','watch','pendant']),
  ('apparel-accessories', 'Apparel Accessories', 'fashion-and-accessories', 30, ARRAY['scarf','glove','hat','belt','sock','sunglasses'])
) AS v(slug, name, parent_slug, sort_order, keywords)
JOIN public.catalogue_categories p ON p.slug = v.parent_slug;

-- ============ scheduled jobs ============
INSERT INTO public.automation_jobs (job_key, label, description, job_type, enabled, schedule_cron, config)
VALUES
  ('catalogue_intelligence_backfill', 'Catalogue intelligence backfill',
   'Works through every synced product in controlled batches so the whole catalogue has a canonical category and current search intelligence.',
   'intelligence', true, '*/10 * * * *', '{"batch_size": 8}'::jsonb),
  ('catalogue_intelligence_daily', 'Daily intelligence maintenance',
   'Checks for stale intelligence, failed work, supplier classification anomalies and missing metadata, then requeues only what genuinely changed.',
   'intelligence', true, '0 3 * * *', '{"batch_size": 12}'::jsonb),
  ('catalogue_quality_audit', 'Weekly catalogue quality audit',
   'Recalculates merchandising quality scores, duplicate suspects and taxonomy consistency without regenerating content.',
   'intelligence', true, '0 4 * * 1', '{}'::jsonb)
ON CONFLICT (job_key) DO NOTHING;