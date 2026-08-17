DROP POLICY IF EXISTS "Staff read categories" ON public.catalogue_categories;
CREATE POLICY "Staff read categories"
ON public.catalogue_categories
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'staff'::app_role)
  OR has_role(auth.uid(), 'viewer'::app_role)
  OR enabled = true
);

DROP POLICY IF EXISTS "Staff read intelligence queue" ON public.intelligence_queue;
CREATE POLICY "Staff read intelligence queue"
ON public.intelligence_queue
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'staff'::app_role)
);