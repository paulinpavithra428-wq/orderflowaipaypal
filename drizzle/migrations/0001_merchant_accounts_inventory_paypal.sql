-- ===== Merchant profiles =====
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL DEFAULT 'My business',
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (business_name) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Merchants read own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Merchants update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, business_name)
  VALUES (NEW.id, COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_name', ''), 'My business'))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.is_demo_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_demo FROM public.profiles WHERE id = auth.uid()), false)
$$;
GRANT EXECUTE ON FUNCTION public.is_demo_user() TO authenticated;

-- Stamps owner + sample flag from the signed-in user; server (service role) inserts keep explicit values.
CREATE OR REPLACE FUNCTION public.set_tenant_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.merchant_id := auth.uid();
    NEW.is_sample := public.is_demo_user();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_merchant_id()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.merchant_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

-- ===== Suppliers =====
CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID,
  is_sample BOOLEAN NOT NULL DEFAULT false,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  lead_time_days INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER suppliers_tenant BEFORE INSERT ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.set_tenant_fields();
CREATE POLICY "Suppliers visible to owner" ON public.suppliers FOR SELECT TO authenticated
  USING (merchant_id = auth.uid() OR (is_sample AND public.is_demo_user()));
CREATE POLICY "Suppliers created by owner" ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (merchant_id = auth.uid() AND is_sample = public.is_demo_user());
CREATE POLICY "Suppliers updated by owner" ON public.suppliers FOR UPDATE TO authenticated
  USING (merchant_id = auth.uid() OR (is_sample AND public.is_demo_user()))
  WITH CHECK (merchant_id = auth.uid() OR (is_sample AND public.is_demo_user()));
CREATE POLICY "Suppliers deleted by owner" ON public.suppliers FOR DELETE TO authenticated
  USING (merchant_id = auth.uid());

-- ===== Products / inventory =====
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID,
  is_sample BOOLEAN NOT NULL DEFAULT false,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  on_hand INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER products_tenant BEFORE INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_tenant_fields();
CREATE POLICY "Products visible to owner" ON public.products FOR SELECT TO authenticated
  USING (merchant_id = auth.uid() OR (is_sample AND public.is_demo_user()));
CREATE POLICY "Products created by owner" ON public.products FOR INSERT TO authenticated
  WITH CHECK (merchant_id = auth.uid() AND is_sample = public.is_demo_user());
CREATE POLICY "Products updated by owner" ON public.products FOR UPDATE TO authenticated
  USING (merchant_id = auth.uid() OR (is_sample AND public.is_demo_user()))
  WITH CHECK (merchant_id = auth.uid() OR (is_sample AND public.is_demo_user()));
CREATE POLICY "Products deleted by owner" ON public.products FOR DELETE TO authenticated
  USING (merchant_id = auth.uid());

-- ===== Orders: tenancy, links, PayPal verification fields =====
ALTER TABLE public.orders
  ADD COLUMN merchant_id UUID,
  ADD COLUMN is_sample BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN payment_source TEXT NOT NULL DEFAULT 'paypal_sandbox',
  ADD COLUMN paypal_order_id TEXT UNIQUE,
  ADD COLUMN payment_verified_at TIMESTAMPTZ,
  ADD COLUMN payment_verified_amount NUMERIC(10,2),
  ADD COLUMN supplier_confirmed_qty INTEGER,
  ADD COLUMN supplier_dispatch_date DATE,
  ADD COLUMN supplier_update TEXT,
  ADD COLUMN supplier_updated_at TIMESTAMPTZ;

UPDATE public.orders SET is_sample = true, payment_source = 'demo', payment_verified_at = ordered_at
  WHERE paypal_payment_status = 'COMPLETED';
UPDATE public.orders SET is_sample = true, payment_source = 'demo' WHERE is_sample = false;

ALTER TABLE public.orders ALTER COLUMN paypal_payment_status SET DEFAULT 'CREATED';
ALTER TABLE public.orders ALTER COLUMN supplier_status SET DEFAULT 'not_confirmed';
CREATE SEQUENCE public.orders_number_seq START 2001;
GRANT USAGE ON SEQUENCE public.orders_number_seq TO authenticated, service_role;
ALTER TABLE public.orders ALTER COLUMN id SET DEFAULT ('PP' || nextval('public.orders_number_seq'));
CREATE TRIGGER orders_tenant BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_tenant_fields();

DROP POLICY IF EXISTS "Orders are readable in the demo workspace" ON public.orders;
REVOKE ALL ON public.orders FROM anon, authenticated;
GRANT SELECT ON public.orders TO authenticated;
-- Payment columns are deliberately NOT grantable: only the server's verified PayPal flow can change them.
GRANT INSERT (customer_name, customer_email, product, sku, quantity, amount, currency, product_id, supplier_id,
  supplier_name, supplier_email, supplier_status, delivery_status) ON public.orders TO authenticated;
GRANT UPDATE (supplier_status, supplier_confirmed_qty, supplier_dispatch_date, supplier_update, supplier_updated_at,
  delivery_status, carrier, tracking_number) ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;

CREATE POLICY "Orders visible to owner" ON public.orders FOR SELECT TO authenticated
  USING (merchant_id = auth.uid() OR (is_sample AND public.is_demo_user()));
CREATE POLICY "Orders created by owner" ON public.orders FOR INSERT TO authenticated
  WITH CHECK (merchant_id = auth.uid() AND is_sample = public.is_demo_user());
CREATE POLICY "Orders fulfilment updated by owner" ON public.orders FOR UPDATE TO authenticated
  USING (merchant_id = auth.uid() OR (is_sample AND public.is_demo_user()))
  WITH CHECK (merchant_id = auth.uid() OR (is_sample AND public.is_demo_user()));

CREATE OR REPLACE FUNCTION public.can_access_order(_order_id TEXT)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = _order_id
      AND (o.merchant_id = auth.uid() OR (o.is_sample AND public.is_demo_user()))
  )
$$;
GRANT EXECUTE ON FUNCTION public.can_access_order(TEXT) TO authenticated;

-- ===== Investigations =====
ALTER TABLE public.investigations
  ADD COLUMN merchant_id UUID,
  ADD COLUMN root_cause TEXT,
  ADD COLUMN business_impact TEXT,
  ADD COLUMN evidence_sufficient BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN decision_note TEXT,
  ADD COLUMN resolved_at TIMESTAMPTZ;
CREATE TRIGGER investigations_merchant BEFORE INSERT ON public.investigations FOR EACH ROW EXECUTE FUNCTION public.set_merchant_id();

DROP POLICY IF EXISTS "Investigations readable in demo" ON public.investigations;
DROP POLICY IF EXISTS "Investigations can be created in demo" ON public.investigations;
DROP POLICY IF EXISTS "Investigations can be decided in demo" ON public.investigations;
REVOKE ALL ON public.investigations FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.investigations TO authenticated;
GRANT ALL ON public.investigations TO service_role;
CREATE POLICY "Investigations visible for accessible orders" ON public.investigations FOR SELECT TO authenticated
  USING (public.can_access_order(order_id));
CREATE POLICY "Investigations created for accessible orders" ON public.investigations FOR INSERT TO authenticated
  WITH CHECK (public.can_access_order(order_id) AND merchant_id = auth.uid() AND status = 'pending');
CREATE POLICY "Investigations decided for accessible orders" ON public.investigations FOR UPDATE TO authenticated
  USING (public.can_access_order(order_id))
  WITH CHECK (public.can_access_order(order_id) AND status IN ('pending','approved','rejected','dismissed','resolved'));

-- ===== Activity log =====
ALTER TABLE public.activity_log ADD COLUMN merchant_id UUID;
CREATE TRIGGER activity_merchant BEFORE INSERT ON public.activity_log FOR EACH ROW EXECUTE FUNCTION public.set_merchant_id();
DROP POLICY IF EXISTS "Activity readable in demo" ON public.activity_log;
DROP POLICY IF EXISTS "Activity can be recorded in demo" ON public.activity_log;
REVOKE ALL ON public.activity_log FROM anon;
GRANT SELECT, INSERT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;
CREATE POLICY "Activity visible to owner" ON public.activity_log FOR SELECT TO authenticated
  USING (merchant_id = auth.uid() OR (order_id IS NOT NULL AND public.can_access_order(order_id)));
CREATE POLICY "Activity recorded by owner" ON public.activity_log FOR INSERT TO authenticated
  WITH CHECK (merchant_id = auth.uid() AND (order_id IS NULL OR public.can_access_order(order_id)));

-- ===== PayPal webhook events (idempotency ledger) =====
CREATE TABLE public.paypal_webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  resource_id TEXT,
  order_id TEXT REFERENCES public.orders(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'received',
  detail TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
GRANT SELECT ON public.paypal_webhook_events TO authenticated;
GRANT ALL ON public.paypal_webhook_events TO service_role;
ALTER TABLE public.paypal_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Webhook events visible for accessible orders" ON public.paypal_webhook_events FOR SELECT TO authenticated
  USING (order_id IS NOT NULL AND public.can_access_order(order_id));

-- ===== Sample (demo) business data =====
INSERT INTO public.suppliers (is_sample, name, email, lead_time_days, notes) VALUES
  (true, 'KeyTech Distributors', 'orders@keytech-dist.example', 3, 'Sample supplier'),
  (true, 'SitWell Furniture Co.', 'supply@sitwell.example', 7, 'Sample supplier'),
  (true, 'BrightView Displays', 'b2b@brightview.example', 4, 'Sample supplier'),
  (true, 'SoundPeak Audio', 'trade@soundpeak.example', 5, 'Sample supplier'),
  (true, 'PortHub Supply', 'sales@porthub.example', 3, 'Sample supplier'),
  (true, 'LumaWorks', 'orders@lumaworks.example', 6, 'Sample supplier');

INSERT INTO public.products (is_sample, sku, name, unit_price, on_hand, supplier_id)
SELECT true, v.sku, v.name, v.price, v.on_hand, s.id
FROM (VALUES
  ('KB-W200','Wireless Keyboard',89.00,14,'KeyTech Distributors'),
  ('CH-ERG5','Ergonomic Office Chair',349.00,0,'SitWell Furniture Co.'),
  ('MN-4K27','4K USB-C Monitor',429.00,6,'BrightView Displays'),
  ('HP-NC700','Noise-Cancelling Headphones',199.00,22,'SoundPeak Audio'),
  ('DK-STD2','Standing Desk Frame',279.00,4,'SitWell Furniture Co.'),
  ('KB-MX90','Mechanical Keyboard Pro',159.00,9,'KeyTech Distributors'),
  ('WC-1080','Webcam 1080p',59.00,31,'BrightView Displays'),
  ('DS-TB4','Laptop Docking Station',219.00,7,'PortHub Supply'),
  ('LP-LED3','Desk Lamp LED',39.00,1,'LumaWorks'),
  ('MS-W150','Wireless Mouse',39.00,48,'KeyTech Distributors'),
  ('HP-ST400','Studio Wireless Headphones',129.00,4,'SoundPeak Audio')
) AS v(sku, name, price, on_hand, supplier)
JOIN public.suppliers s ON s.name = v.supplier AND s.is_sample;

INSERT INTO public.orders (id, customer_name, customer_email, product, sku, quantity, amount, paypal_transaction_id,
  paypal_payment_status, inventory_status, inventory_on_hand, supplier_name, supplier_email, supplier_status,
  delivery_status, ordered_at, is_sample, payment_source, payment_verified_at, supplier_update, supplier_updated_at)
VALUES ('PP1034','Olivia Bennett','olivia.bennett@example.com','Studio Wireless Headphones','HP-ST400',10,1290.00,
  '0VF52814937998046','COMPLETED','low',4,'SoundPeak Audio','trade@soundpeak.example','pending','not_scheduled',
  now() - interval '2 days', true, 'demo', now() - interval '2 days',
  'Restock request acknowledged by SoundPeak. No confirmed quantity or dispatch date has been provided yet.',
  now() - interval '1 day');

UPDATE public.orders o SET product_id = p.id, supplier_id = p.supplier_id
FROM public.products p WHERE p.is_sample AND p.sku = o.sku AND o.is_sample;