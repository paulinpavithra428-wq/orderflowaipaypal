CREATE TABLE public.orders (
  id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  product TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  paypal_transaction_id TEXT,
  paypal_payment_status TEXT NOT NULL DEFAULT 'COMPLETED',
  inventory_status TEXT NOT NULL DEFAULT 'available',
  inventory_on_hand INTEGER NOT NULL DEFAULT 0,
  supplier_name TEXT NOT NULL,
  supplier_email TEXT NOT NULL,
  supplier_status TEXT NOT NULL DEFAULT 'pending',
  delivery_status TEXT NOT NULL DEFAULT 'not_scheduled',
  carrier TEXT,
  tracking_number TEXT,
  ordered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.orders TO anon, authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Orders are readable in the demo workspace" ON public.orders FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.investigations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  bottleneck_key TEXT NOT NULL,
  bottleneck_label TEXT NOT NULL,
  priority TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  finding TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  explanation TEXT NOT NULL,
  message_recipient TEXT,
  message_subject TEXT,
  suggested_message TEXT,
  payment_source TEXT NOT NULL DEFAULT 'demo',
  ai_generated BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX investigations_order_idx ON public.investigations(order_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.investigations TO anon, authenticated;
GRANT ALL ON public.investigations TO service_role;
ALTER TABLE public.investigations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Investigations readable in demo" ON public.investigations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Investigations can be created in demo" ON public.investigations FOR INSERT TO anon, authenticated WITH CHECK (status = 'pending');
CREATE POLICY "Investigations can be decided in demo" ON public.investigations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (status IN ('pending','approved','dismissed'));

CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT REFERENCES public.orders(id) ON DELETE SET NULL,
  investigation_id UUID REFERENCES public.investigations(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activity_log_created_idx ON public.activity_log(created_at DESC);

GRANT SELECT, INSERT ON public.activity_log TO anon, authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Activity readable in demo" ON public.activity_log FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Activity can be recorded in demo" ON public.activity_log FOR INSERT TO anon, authenticated WITH CHECK (action_type IN ('investigation_run','action_approved','message_edited','recommendation_dismissed'));

INSERT INTO public.orders (id, customer_name, customer_email, product, sku, quantity, amount, paypal_transaction_id, paypal_payment_status, inventory_status, inventory_on_hand, supplier_name, supplier_email, supplier_status, delivery_status, carrier, tracking_number, ordered_at) VALUES
('PP1024','Amelia Hart','amelia.hart@example.com','Wireless Keyboard','KB-W200',1,89.00,'8XK21934LM5520417','COMPLETED','available',14,'KeyTech Distributors','orders@keytech-dist.example','not_confirmed','not_scheduled',NULL,NULL, now() - interval '3 days'),
('PP1025','Rohan Mehta','rohan.mehta@example.com','Ergonomic Office Chair','CH-ERG5',1,349.00,'5TY90211AB3398722','COMPLETED','unavailable',0,'SitWell Furniture Co.','supply@sitwell.example','confirmed','not_scheduled',NULL,NULL, now() - interval '5 days'),
('PP1026','Grace Okafor','grace.okafor@example.com','4K USB-C Monitor','MN-4K27',1,429.00,'2GH77810QW6612093','COMPLETED','available',6,'BrightView Displays','b2b@brightview.example','confirmed','not_scheduled',NULL,NULL, now() - interval '2 days'),
('PP1027','Lucas Moreau','lucas.moreau@example.com','Noise-Cancelling Headphones','HP-NC700',2,398.00,'9LP33045ZX1184560','COMPLETED','available',22,'SoundPeak Audio','trade@soundpeak.example','confirmed','delivered','UPS','1Z999AA10123456784', now() - interval '9 days'),
('PP1028','Priya Nair','priya.nair@example.com','Standing Desk Frame','DK-STD2',1,279.00,'4MN55120RT0047731','COMPLETED','available',4,'SitWell Furniture Co.','supply@sitwell.example','confirmed','in_transit','FedEx','794616896420', now() - interval '4 days'),
('PP1029','Daniel Kim','daniel.kim@example.com','Mechanical Keyboard Pro','KB-MX90',1,159.00,'7QA10299VB5521846','PENDING','available',9,'KeyTech Distributors','orders@keytech-dist.example','pending','not_scheduled',NULL,NULL, now() - interval '1 day'),
('PP1030','Sofia Rossi','sofia.rossi@example.com','Webcam 1080p','WC-1080',3,177.00,'3ZC88412KP9036615','COMPLETED','available',31,'BrightView Displays','b2b@brightview.example','confirmed','delivered','DHL','JD014600006281230', now() - interval '12 days'),
('PP1031','Ethan Brooks','ethan.brooks@example.com','Laptop Docking Station','DS-TB4',1,219.00,'6RW20577HN3349081','COMPLETED','available',7,'PortHub Supply','sales@porthub.example','confirmed','scheduled','UPS','1Z999AA10123459921', now() - interval '1 day'),
('PP1032','Hannah Lee','hannah.lee@example.com','Desk Lamp LED','LP-LED3',2,78.00,'1DE64730JS8820457','COMPLETED','low',1,'LumaWorks','orders@lumaworks.example','not_confirmed','not_scheduled',NULL,NULL, now() - interval '6 days'),
('PP1033','Marcus Silva','marcus.silva@example.com','Wireless Mouse','MS-W150',1,39.00,'8PL09912TY4471203','COMPLETED','available',48,'KeyTech Distributors','orders@keytech-dist.example','confirmed','delivered','USPS','9400111899223344556677', now() - interval '15 days');

INSERT INTO public.activity_log (order_id, action_type, description, details, created_at) VALUES
('PP1027','action_approved','Owner approved shipping arrangement with UPS for PP1027.','{"seed":true}'::jsonb, now() - interval '8 days'),
('PP1030','action_approved','Owner approved supplier confirmation follow-up for PP1030.','{"seed":true}'::jsonb, now() - interval '11 days');