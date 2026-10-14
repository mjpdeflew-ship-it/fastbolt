-- BoltHouse material filter migration
-- Run this once in Supabase Dashboard -> SQL Editor.
-- Existing products are marked Steel by default. Edit stainless-steel items
-- in Admin -> Products and set Material to "Stainless steel".

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS material text NOT NULL DEFAULT 'steel';

UPDATE public.products
SET material = 'steel'
WHERE material IS NULL OR material NOT IN ('steel', 'stainless_steel');

ALTER TABLE public.products
  ALTER COLUMN material SET DEFAULT 'steel';

ALTER TABLE public.products
  ALTER COLUMN material SET NOT NULL;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_material_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_material_check
  CHECK (material IN ('steel', 'stainless_steel'));

GRANT UPDATE (material) ON public.products TO authenticated;

NOTIFY pgrst, 'reload schema';
