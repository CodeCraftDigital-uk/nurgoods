DROP POLICY IF EXISTS "Signed in staff can read market eligibility" ON public.product_market_eligibility;

CREATE POLICY "Admins can read market eligibility"
  ON public.product_market_eligibility
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));