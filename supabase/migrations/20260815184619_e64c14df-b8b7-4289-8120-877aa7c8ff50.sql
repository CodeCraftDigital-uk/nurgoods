CREATE TABLE public.editorial_plan_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_month date NOT NULL,
  title text NOT NULL,
  slug_hint text,
  target_query text,
  search_intent text,
  audience text,
  angle text,
  keywords text[] NOT NULL DEFAULT '{}',
  related_handles text[] NOT NULL DEFAULT '{}',
  planned_for date NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL,
  attempts integer NOT NULL DEFAULT 0,
  failure_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX editorial_plan_items_title_month_idx
  ON public.editorial_plan_items (plan_month, lower(title));
CREATE INDEX editorial_plan_items_queue_idx
  ON public.editorial_plan_items (status, planned_for);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.editorial_plan_items TO authenticated;
GRANT ALL ON public.editorial_plan_items TO service_role;
ALTER TABLE public.editorial_plan_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage the editorial plan"
  ON public.editorial_plan_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER set_updated_at_editorial_plan_items
  BEFORE UPDATE ON public.editorial_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.automation_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_key text NOT NULL,
  run_key text NOT NULL UNIQUE,
  status run_status NOT NULL DEFAULT 'running',
  message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  entity_id uuid,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  finished_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX automation_runs_job_idx ON public.automation_runs (job_key, started_at DESC);

GRANT SELECT ON public.automation_runs TO authenticated;
GRANT ALL ON public.automation_runs TO service_role;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read automation runs"
  ON public.automation_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER set_updated_at_automation_runs
  BEFORE UPDATE ON public.automation_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.automation_jobs (job_key, label, description, job_type, enabled, schedule_cron, requires_integration)
VALUES
  ('monthly_editorial_plan', 'Monthly editorial plan', 'Builds next month''s Journal topic plan from the synced catalogue and existing coverage, with unique topics and planned publication dates.', 'scheduled', true, '0 6 1 * *', 'ai_provider'),
  ('daily_article_publish', 'Daily article publication', 'Takes the next planned topic, writes the article, creates the hero image, runs the quality checks and publishes automatically when every check passes.', 'scheduled', true, '0 7 * * *', 'ai_provider')
ON CONFLICT (job_key) DO UPDATE
  SET label = EXCLUDED.label,
      description = EXCLUDED.description,
      schedule_cron = EXCLUDED.schedule_cron,
      requires_integration = EXCLUDED.requires_integration;