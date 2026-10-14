-- BoltHouse administrator permissions
-- Run this once in Supabase Dashboard -> SQL Editor.
-- The page performs owner checks in the UI; these policies enforce access in the database.

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.products FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.products TO anon, authenticated;
GRANT INSERT, DELETE ON public.products TO authenticated;
GRANT UPDATE (category, type, size, length, price, in_stock) ON public.products TO authenticated;

DROP POLICY IF EXISTS "Anyone can view in-stock products" ON public.products;
DROP POLICY IF EXISTS "Anyone can view products" ON public.products;
DROP POLICY IF EXISTS "BoltHouse product catalogue visibility" ON public.products;
CREATE POLICY "BoltHouse product catalogue visibility"
ON public.products FOR SELECT TO anon, authenticated
USING (
  in_stock = true
  OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  OR COALESCE(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ? 'admin'
);

DROP POLICY IF EXISTS "Admins can insert products" ON public.products;
DROP POLICY IF EXISTS "BoltHouse admins can insert products" ON public.products;
CREATE POLICY "BoltHouse admins can insert products"
ON public.products FOR INSERT TO authenticated
WITH CHECK (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  OR COALESCE(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ? 'admin'
);

DROP POLICY IF EXISTS "Admins can update products" ON public.products;
DROP POLICY IF EXISTS "BoltHouse admins can update products" ON public.products;
CREATE POLICY "BoltHouse admins can update products"
ON public.products FOR UPDATE TO authenticated
USING (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  OR COALESCE(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ? 'admin'
)
WITH CHECK (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  OR COALESCE(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ? 'admin'
);

DROP POLICY IF EXISTS "BoltHouse admins can delete products" ON public.products;
CREATE POLICY "BoltHouse admins can delete products"
ON public.products FOR DELETE TO authenticated
USING (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  OR COALESCE(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ? 'admin'
);

-- Remove any older/overly broad product policies so these rules are authoritative.
DO $
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname, cmd FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'products'
      AND (
        cmd = 'ALL'
        OR (cmd = 'SELECT' AND policyname <> 'BoltHouse product catalogue visibility')
        OR (cmd = 'INSERT' AND policyname <> 'BoltHouse admins can insert products')
        OR (cmd = 'UPDATE' AND policyname <> 'BoltHouse admins can update products')
        OR (cmd = 'DELETE' AND policyname <> 'BoltHouse admins can delete products')
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON public.products', p.policyname);
  END LOOP;
END $;

-- Storefront content/contact details editable from the admin dashboard.
CREATE TABLE IF NOT EXISTS public.site_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  store_name text NOT NULL DEFAULT 'BoltHouse',
  hero_title text NOT NULL DEFAULT 'Bolts, screws, nuts & washers.',
  hero_description text NOT NULL DEFAULT 'Metric M3 to M20. Buy a single piece or hundreds — you choose the quantity.',
  perk_one text NOT NULL DEFAULT 'Sold per piece',
  perk_two text NOT NULL DEFAULT 'M3 – M20',
  perk_three text NOT NULL DEFAULT 'Bulk quotes available',
  whatsapp text NOT NULL DEFAULT '201552155041',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_settings FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.site_settings TO anon, authenticated;
GRANT UPDATE (store_name, hero_title, hero_description, perk_one, perk_two, perk_three, whatsapp, updated_at) ON public.site_settings TO authenticated;

INSERT INTO public.site_settings (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "BoltHouse public settings read" ON public.site_settings;
CREATE POLICY "BoltHouse public settings read"
ON public.site_settings FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "BoltHouse admins can update settings" ON public.site_settings;
CREATE POLICY "BoltHouse admins can update settings"
ON public.site_settings FOR UPDATE TO authenticated
USING (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  OR COALESCE(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ? 'admin'
)
WITH CHECK (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  OR COALESCE(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ? 'admin'
);

DO $
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname, cmd FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'site_settings'
      AND (
        cmd = 'ALL'
        OR (cmd = 'SELECT' AND policyname <> 'BoltHouse public settings read')
        OR (cmd = 'UPDATE' AND policyname <> 'BoltHouse admins can update settings')
        OR cmd IN ('INSERT', 'DELETE')
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON public.site_settings', p.policyname);
  END LOOP;
END $;

-- Add order workflow status while keeping existing orders.
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new';
REVOKE ALL ON public.orders FROM anon, authenticated, PUBLIC;
GRANT INSERT ON public.orders TO anon, authenticated;
GRANT SELECT ON public.orders TO authenticated;
GRANT UPDATE (status) ON public.orders TO authenticated;

-- Customers must be able to submit orders from the storefront.
DROP POLICY IF EXISTS "BoltHouse customers can submit orders" ON public.orders;
CREATE POLICY "BoltHouse customers can submit orders"
ON public.orders FOR INSERT TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "BoltHouse admins can read orders" ON public.orders;
CREATE POLICY "BoltHouse admins can read orders"
ON public.orders FOR SELECT TO authenticated
USING (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  OR COALESCE(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ? 'admin'
);

DROP POLICY IF EXISTS "BoltHouse admins can update order status" ON public.orders;
CREATE POLICY "BoltHouse admins can update order status"
ON public.orders FOR UPDATE TO authenticated
USING (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  OR COALESCE(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ? 'admin'
)
WITH CHECK (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  OR COALESCE(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ? 'admin'
);

-- Orders contain customer contact details: only admins may read them or update status.
DO $
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname, cmd FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'orders'
      AND (
        cmd = 'ALL'
        OR (cmd = 'SELECT' AND policyname <> 'BoltHouse admins can read orders')
        OR (cmd = 'INSERT' AND policyname <> 'BoltHouse customers can submit orders')
        OR (cmd = 'UPDATE' AND policyname <> 'BoltHouse admins can update order status')
        OR cmd = 'DELETE'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON public.orders', p.policyname);
  END LOOP;
END $;
