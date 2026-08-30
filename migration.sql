-- 1. Enable Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 2. Create Tables
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  store_id uuid references public.stores(id) on delete cascade,
  email text unique,
  name text,
  role text check (role in ('admin', 'employee')),
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade not null,
  name text,
  phone text,
  created_at timestamptz not null default now()
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade not null,
  employee_id uuid references public.profiles(id) on delete set null,
  description text not null,
  payment_method text check (payment_method in ('cash', 'transfer', 'card')) not null,
  total_amount numeric(10,2) not null,
  client_id uuid references public.clients(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 3. Helper Functions for RLS
create or replace function public.get_current_user_store_id()
returns uuid
language sql
security definer
set search_path = public
as $$
  select store_id from public.profiles where id = auth.uid();
$$;

create or replace function public.get_current_user_role()
returns text
language sql
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- 4. Enable Row Level Security
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.sales enable row level security;

-- 5. RLS Policies

-- Stores policies
create policy "Users can access their own store" on public.stores
  for all
  to authenticated
  using (id = public.get_current_user_store_id());

-- Profiles policies
create policy "Users can view profiles in the same store" on public.profiles
  for select
  to authenticated
  using (store_id = public.get_current_user_store_id() or id = auth.uid());

create policy "Admins can manage profiles in the same store" on public.profiles
  for all
  to authenticated
  using (store_id = public.get_current_user_store_id() and (id = auth.uid() or public.get_current_user_role() = 'admin'))
  with check (store_id = public.get_current_user_store_id() and (id = auth.uid() or public.get_current_user_role() = 'admin'));

-- Clients policies
create policy "Users can view clients in the same store" on public.clients
  for select
  to authenticated
  using (store_id = public.get_current_user_store_id());

create policy "Users can manage clients in the same store" on public.clients
  for all
  to authenticated
  using (store_id = public.get_current_user_store_id())
  with check (store_id = public.get_current_user_store_id());

-- Sales policies
create policy "Users can view sales in the same store" on public.sales
  for select
  to authenticated
  using (store_id = public.get_current_user_store_id());

create policy "Users can manage sales in the same store" on public.sales
  for all
  to authenticated
  using (store_id = public.get_current_user_store_id())
  with check (store_id = public.get_current_user_store_id());

-- 6. Trigger Function for Signups
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_profile_id uuid;
  v_store_id uuid;
begin
  -- Check if the email exists in public.profiles (pre-created by admin)
  select id, store_id into v_profile_id, v_store_id
  from public.profiles
  where lower(email) = lower(new.email);

  if v_profile_id is not null then
    -- Preloaded profile found:
    -- Update the profile's ID to be the new auth.users.id
    update public.profiles
    set id = new.id
    where id = v_profile_id;

    -- Now delete the dummy user from auth.users that had the old v_profile_id
    delete from auth.users
    where id = v_profile_id;
  else
    -- New owner registration:
    -- Create a new store
    insert into public.stores (name)
    values (coalesce(new.raw_user_meta_data->>'store_name', 'My Store'))
    returning id into v_store_id;

    -- Create the admin profile
    insert into public.profiles (id, store_id, email, name, role)
    values (
      new.id,
      v_store_id,
      new.email,
      coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
      'admin'
    );
  end if;

  return new;
end;
$$;

-- Create Trigger on auth.users
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 7. Admin Helper Function to Preload Employees
create or replace function public.preload_employee(
  p_email text,
  p_name text,
  p_role text,
  p_store_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_dummy_id uuid;
begin
  -- Validate role
  if p_role not in ('admin', 'employee') then
    raise exception 'Invalid role: must be admin or employee';
  end if;

  -- Check if caller is admin of the store
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and store_id = p_store_id
  ) then
    raise exception 'Unauthorized: Only store admins can preload employees';
  end if;

  -- Generate dummy UUID
  v_dummy_id := gen_random_uuid();

  -- Insert dummy user into auth.users (to satisfy foreign key)
  insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
  values (
    v_dummy_id,
    null, -- null email prevents conflicts with future signups
    '{"provider":"email"}'::jsonb,
    '{}'::jsonb,
    'authenticated',
    'authenticated'
  );

  -- Insert profile
  insert into public.profiles (id, store_id, email, name, role)
  values (v_dummy_id, p_store_id, p_email, p_name, p_role);

  return v_dummy_id;
end;
$$;

-- 8. Super Admin Support & Whitelist
-- 8.1 Drop old check constraint on profiles.role and create a new one allowing 'superadmin'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'employee', 'superadmin'));

-- 8.2 Create allowed_admins table
CREATE TABLE IF NOT EXISTS public.allowed_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  store_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 8.3 Enable RLS on allowed_admins
ALTER TABLE public.allowed_admins ENABLE ROW LEVEL SECURITY;

-- 8.4 Create RLS Policy for allowed_admins
CREATE POLICY "Superadmins can do everything on allowed_admins" ON public.allowed_admins
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE profiles.id = auth.uid() AND profiles.role = 'superadmin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE profiles.id = auth.uid() AND profiles.role = 'superadmin'
    )
  );

-- 8.5 Update handle_new_user trigger function to use allowed_admins whitelist
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_profile_id uuid;
  v_store_id uuid;
  v_allowed_store_name text;
BEGIN
  -- If new.email is null (e.g. dummy user created during preload_employee), do nothing and return new
  IF new.email IS NULL THEN
    RETURN new;
  END IF;

  -- Check if the email exists in public.profiles (pre-created by admin/employee)
  SELECT id, store_id INTO v_profile_id, v_store_id
  FROM public.profiles
  WHERE lower(email) = lower(new.email);

  IF v_profile_id IS NOT NULL THEN
    -- Preloaded profile found:
    -- Update the profile's ID to be the new auth.users.id
    UPDATE public.profiles
    SET id = new.id
    WHERE id = v_profile_id;

    -- Now delete the dummy user from auth.users that had the old v_profile_id
    DELETE FROM auth.users
    WHERE id = v_profile_id;
  ELSE
    -- New owner registration:
    -- Check if the email is in allowed_admins whitelist
    SELECT store_name INTO v_allowed_store_name
    FROM public.allowed_admins
    WHERE lower(email) = lower(new.email);

    IF v_allowed_store_name IS NOT NULL THEN
      -- Create a new store using the authorized name
      INSERT INTO public.stores (name)
      VALUES (v_allowed_store_name)
      RETURNING id INTO v_store_id;

      -- Create the admin profile
      INSERT INTO public.profiles (id, store_id, email, name, role)
      VALUES (
        new.id,
        v_store_id,
        new.email,
        coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
        'admin'
      );

      -- Delete from allowed_admins whitelist since registration is complete
      DELETE FROM public.allowed_admins
      WHERE lower(email) = lower(new.email);
    ELSE
      -- Raise exception to block unauthorized registration
      RAISE EXCEPTION 'El correo % no está autorizado para registrarse.', new.email;
    END IF;
  END IF;

  RETURN new;
END;
$$;


-- 9. Stored procedures for employee user deletion and modification (Admin actions)

CREATE OR REPLACE FUNCTION public.delete_employee_user(p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_store_id uuid;
BEGIN
  -- Get the store_id of the employee being deleted
  SELECT store_id INTO v_store_id
  FROM public.profiles
  WHERE id = p_employee_id;

  -- Check if caller is admin of the same store
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND store_id = v_store_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only store admins can delete employees';
  END IF;

  -- Prevent deleting yourself
  IF p_employee_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete your own user profile';
  END IF;

  -- Detach sales from this employee (preserve history, nullify reference)
  UPDATE public.sales
  SET employee_id = NULL
  WHERE employee_id = p_employee_id;

  -- Delete from auth.users (which cascades to public.profiles)
  DELETE FROM auth.users
  WHERE id = p_employee_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.update_employee_user(
  p_employee_id uuid,
  p_name text,
  p_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_store_id uuid;
BEGIN
  -- Get the store_id of the employee being edited
  SELECT store_id INTO v_store_id
  FROM public.profiles
  WHERE id = p_employee_id;

  -- Check if caller is admin of the same store
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND store_id = v_store_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only store admins can edit employees';
  END IF;

  -- Update profiles
  UPDATE public.profiles
  SET name = p_name,
      email = p_email
  WHERE id = p_employee_id;

  -- Update auth.users email (if not a preloaded dummy user without email)
  UPDATE auth.users
  SET email = p_email
  WHERE id = p_employee_id AND email IS NOT NULL;
END;
$$;

-- 10. Super Admin RLS Policies for Whitelist, Profiles, and Stores
-- 10.1 allowed_admins policies
DROP POLICY IF EXISTS "Superadmins can do everything on allowed_admins" ON public.allowed_admins;
CREATE POLICY "Superadmins can do everything on allowed_admins" ON public.allowed_admins
  FOR ALL
  TO authenticated
  USING (public.get_current_user_role() = 'superadmin')
  WITH CHECK (public.get_current_user_role() = 'superadmin');

-- 10.2 profiles policies
DROP POLICY IF EXISTS "Superadmins can do everything on profiles" ON public.profiles;
CREATE POLICY "Superadmins can do everything on profiles" ON public.profiles
  FOR ALL
  TO authenticated
  USING (public.get_current_user_role() = 'superadmin')
  WITH CHECK (public.get_current_user_role() = 'superadmin');

-- 10.3 stores policies
DROP POLICY IF EXISTS "Superadmins can do everything on stores" ON public.stores;
CREATE POLICY "Superadmins can do everything on stores" ON public.stores
  FOR ALL
  TO authenticated
  USING (public.get_current_user_role() = 'superadmin')
  WITH CHECK (public.get_current_user_role() = 'superadmin');


-- 11. Product Price Rules (Stock) — Reglas de precio especial por cantidad
CREATE TABLE IF NOT EXISTS public.product_price_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE NOT NULL,
  product_name text NOT NULL,           -- nombre del producto (ej: "Remera")
  quantity int NOT NULL,                -- cantidad especial (ej: 12 para docena)
  special_price numeric(10,2) NOT NULL, -- precio total para esa cantidad (ej: 50000)
  unit_price numeric(10,2) NOT NULL,    -- precio unitario normal (ej: 5000)
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_price_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage price rules in their store" ON public.product_price_rules;
CREATE POLICY "Users can manage price rules in their store" ON public.product_price_rules
  FOR ALL TO authenticated
  USING (store_id = public.get_current_user_store_id())
  WITH CHECK (store_id = public.get_current_user_store_id());

-- 12. Thermal printer paper width setting per store
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS thermal_paper_width text NOT NULL DEFAULT '58mm'
  CHECK (thermal_paper_width IN ('58mm', '80mm'));

-- 13. Product catalog, sale line items (Stock Phase 1)

-- 13.1 Categories
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS categories_store_id_idx ON public.categories (store_id);

-- 13.2 Products
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  barcode text,
  purchase_price numeric(10,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  sale_price numeric(10,2) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_store_id_idx ON public.products (store_id);
CREATE INDEX IF NOT EXISTS products_category_id_idx ON public.products (category_id);
CREATE UNIQUE INDEX IF NOT EXISTS products_store_barcode_uidx
  ON public.products (store_id, barcode) WHERE barcode IS NOT NULL;

-- 13.3 Sale line items
CREATE TABLE IF NOT EXISTS public.sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE NOT NULL,
  sale_id uuid REFERENCES public.sales(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  unit_price numeric(10,2) NOT NULL CHECK (unit_price >= 0),
  subtotal numeric(10,2) NOT NULL CHECK (subtotal >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sale_items_sale_id_idx ON public.sale_items (sale_id);
CREATE INDEX IF NOT EXISTS sale_items_product_id_idx ON public.sale_items (product_id);
CREATE INDEX IF NOT EXISTS sale_items_store_id_idx ON public.sale_items (store_id);

-- 13.4 Enable RLS
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

-- 13.5 RLS policies (verbatim pattern from sections 5 and 11)
DROP POLICY IF EXISTS "Users can manage categories in their store" ON public.categories;
CREATE POLICY "Users can manage categories in their store" ON public.categories
  FOR ALL TO authenticated
  USING (store_id = public.get_current_user_store_id())
  WITH CHECK (store_id = public.get_current_user_store_id());

DROP POLICY IF EXISTS "Users can manage products in their store" ON public.products;
CREATE POLICY "Users can manage products in their store" ON public.products
  FOR ALL TO authenticated
  USING (store_id = public.get_current_user_store_id())
  WITH CHECK (store_id = public.get_current_user_store_id());

DROP POLICY IF EXISTS "Users can manage sale items in their store" ON public.sale_items;
CREATE POLICY "Users can manage sale items in their store" ON public.sale_items
  FOR ALL TO authenticated
  USING (store_id = public.get_current_user_store_id())
  WITH CHECK (store_id = public.get_current_user_store_id());

-- 13.6 Price rules: nullable product_id ALONGSIDE product_name.
-- Dropping product_name is EXPLICITLY OUT OF SCOPE for this phase.
ALTER TABLE public.product_price_rules
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS product_price_rules_product_id_idx
  ON public.product_price_rules (product_id);

-- 13.7 sales.description is currently NOT NULL. Make it nullable.
ALTER TABLE public.sales ALTER COLUMN description DROP NOT NULL;

-- ROLLBACK (do not run automatically) — reverse of section 13, top to bottom:
-- ALTER TABLE public.sales ALTER COLUMN description SET NOT NULL;  -- only if no NULLs exist
-- DROP INDEX IF EXISTS public.product_price_rules_product_id_idx;
-- ALTER TABLE public.product_price_rules DROP COLUMN IF EXISTS product_id;
-- DROP TABLE IF EXISTS public.sale_items CASCADE;
-- DROP TABLE IF EXISTS public.products   CASCADE;
-- DROP TABLE IF EXISTS public.categories CASCADE;

-- 14. Branches (sucursales) — per-store physical locations

-- 14.1 branches table (column shape mirrors categories, :447-455)
CREATE TABLE IF NOT EXISTS public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS branches_store_id_idx ON public.branches (store_id);

-- 14.2 RLS: read for the whole store, write for admins (mirrors profiles, :74-83)
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view branches in their store" ON public.branches;
CREATE POLICY "Users can view branches in their store" ON public.branches
  FOR SELECT TO authenticated
  USING (store_id = public.get_current_user_store_id());

DROP POLICY IF EXISTS "Admins can manage branches in their store" ON public.branches;
CREATE POLICY "Admins can manage branches in their store" ON public.branches
  FOR ALL TO authenticated
  USING (store_id = public.get_current_user_store_id()
         AND public.get_current_user_role() IN ('admin', 'superadmin'))
  WITH CHECK (store_id = public.get_current_user_store_id()
              AND public.get_current_user_role() IN ('admin', 'superadmin'));

-- 14.3 profiles.branch_id (CHECK is added last, in 14.9)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
CREATE INDEX IF NOT EXISTS profiles_branch_id_idx ON public.profiles (branch_id);

-- 14.4 helper — identical shape to get_current_user_store_id() (:41-48)
CREATE OR REPLACE FUNCTION public.get_current_user_branch_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branch_id FROM public.profiles WHERE id = auth.uid();
$$;

-- 14.5 sales.branch_id — attribution only; sales RLS stays store-wide
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
CREATE INDEX IF NOT EXISTS sales_branch_id_idx ON public.sales (branch_id);

-- 14.6 preload_employee gains p_branch_id (5 args; old 4-arg version is DROPped)
DROP FUNCTION IF EXISTS public.preload_employee(text, text, text, uuid);
CREATE FUNCTION public.preload_employee(
  p_email text, p_name text, p_role text, p_store_id uuid, p_branch_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE v_dummy_id uuid;
BEGIN
  IF p_role NOT IN ('admin', 'employee') THEN
    RAISE EXCEPTION 'Invalid role: must be admin or employee';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid() AND role = 'admin' AND store_id = p_store_id) THEN
    RAISE EXCEPTION 'Unauthorized: Only store admins can preload employees';
  END IF;

  -- Branch is mandatory for employees and mirrors profiles_employee_branch_check.
  IF p_role = 'employee' AND p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required for employee profiles';
  END IF;

  -- SECURITY DEFINER bypasses RLS: verify the branch belongs to this store.
  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches WHERE id = p_branch_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Invalid branch for this store';
  END IF;

  v_dummy_id := gen_random_uuid();

  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
  VALUES (v_dummy_id, null, '{"provider":"email"}'::jsonb, '{}'::jsonb,
          'authenticated', 'authenticated');

  INSERT INTO public.profiles (id, store_id, email, name, role, branch_id)
  VALUES (v_dummy_id, p_store_id, p_email, p_name, p_role,
          CASE WHEN p_role = 'employee' THEN p_branch_id ELSE NULL END);

  RETURN v_dummy_id;
END;
$$;

-- 14.7 update_employee_user gains p_branch_id (old 3-arg version is DROPped)
DROP FUNCTION IF EXISTS public.update_employee_user(uuid, text, text);
CREATE FUNCTION public.update_employee_user(
  p_employee_id uuid, p_name text, p_email text, p_branch_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_store_id uuid;
  v_role     text;
BEGIN
  SELECT store_id, role INTO v_store_id, v_role
  FROM public.profiles WHERE id = p_employee_id;

  IF NOT EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid() AND role = 'admin' AND store_id = v_store_id) THEN
    RAISE EXCEPTION 'Unauthorized: Only store admins can edit employees';
  END IF;

  IF v_role = 'employee' AND p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required for employee profiles';
  END IF;

  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches WHERE id = p_branch_id AND store_id = v_store_id
  ) THEN
    RAISE EXCEPTION 'Invalid branch for this store';
  END IF;

  UPDATE public.profiles
  SET name = p_name,
      email = p_email,
      branch_id = CASE WHEN v_role = 'employee' THEN p_branch_id ELSE branch_id END
  WHERE id = p_employee_id;

  UPDATE auth.users SET email = p_email
  WHERE id = p_employee_id AND email IS NOT NULL;
END;
$$;

-- 14.8 handle_new_user: a new store gets "Sucursal Principal" in the same
-- transaction. Only the ELSE (new-owner) branch changes; the preloaded-profile
-- relink path is byte-identical to :267-276 and keeps the branch preload set.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_profile_id          uuid;
  v_store_id            uuid;
  v_allowed_store_name  text;
BEGIN
  IF new.email IS NULL THEN RETURN new; END IF;

  SELECT id, store_id INTO v_profile_id, v_store_id
  FROM public.profiles WHERE lower(email) = lower(new.email);

  IF v_profile_id IS NOT NULL THEN
    UPDATE public.profiles SET id = new.id WHERE id = v_profile_id;
    DELETE FROM auth.users WHERE id = v_profile_id;
  ELSE
    SELECT store_name INTO v_allowed_store_name
    FROM public.allowed_admins WHERE lower(email) = lower(new.email);

    IF v_allowed_store_name IS NOT NULL THEN
      INSERT INTO public.stores (name) VALUES (v_allowed_store_name)
      RETURNING id INTO v_store_id;

      -- No store is ever branchless.
      INSERT INTO public.branches (store_id, name)
      VALUES (v_store_id, 'Sucursal Principal');

      -- Admin profile keeps branch_id NULL and floats across every branch.
      INSERT INTO public.profiles (id, store_id, email, name, role)
      VALUES (new.id, v_store_id, new.email,
              coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
              'admin');

      DELETE FROM public.allowed_admins WHERE lower(email) = lower(new.email);
    ELSE
      RAISE EXCEPTION 'El correo % no está autorizado para registrarse.', new.email;
    END IF;
  END IF;

  RETURN new;
END;
$$;

-- 14.9 Employee/admin split, added LAST so a partial apply never breaks invites.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_employee_branch_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_employee_branch_check
  CHECK (role <> 'employee' OR branch_id IS NOT NULL);

-- ROLLBACK (do not run automatically) — reverse of section 14, bottom to top:
-- ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_employee_branch_check;
-- -- Restore the pre-branch handle_new_user() body verbatim from migration.sql:246-311.
-- DROP FUNCTION IF EXISTS public.update_employee_user(uuid, text, text, uuid);
-- -- Restore the 3-arg update_employee_user() verbatim from migration.sql:355-392.
-- DROP FUNCTION IF EXISTS public.preload_employee(text, text, text, uuid, uuid);
-- -- Restore the 4-arg preload_employee() verbatim from migration.sql:163-210.
-- DROP INDEX    IF EXISTS public.sales_branch_id_idx;
-- ALTER TABLE public.sales    DROP COLUMN IF EXISTS branch_id;
-- DROP FUNCTION IF EXISTS public.get_current_user_branch_id();
-- DROP INDEX    IF EXISTS public.profiles_branch_id_idx;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS branch_id;
-- DROP TABLE    IF EXISTS public.branches CASCADE;

-- 15. Branch stock, movement ledger, product codes (Stock Phase 2)

-- 15.1 Coherence keys: make (store_id, id) referenceable so branch/product can never
--      be paired with a foreign store. Additive, no data change.
ALTER TABLE public.branches DROP CONSTRAINT IF EXISTS branches_store_id_id_key;
ALTER TABLE public.branches ADD  CONSTRAINT branches_store_id_id_key UNIQUE (store_id, id);
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_store_id_id_key;
ALTER TABLE public.products ADD  CONSTRAINT products_store_id_id_key UNIQUE (store_id, id);

-- 15.2 Global product code sequence + EAN-8 generator
CREATE SEQUENCE IF NOT EXISTS public.product_code_seq
  AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9999999 NO CYCLE;

CREATE OR REPLACE FUNCTION public.ean8_check_digit(p_payload text)
RETURNS int
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = public
AS $$
DECLARE v_sum int := 0; i int;
BEGIN
  IF p_payload !~ '^[0-9]{7}$' THEN
    RAISE EXCEPTION 'EAN-8 payload must be exactly 7 digits, got %', p_payload;
  END IF;
  -- Odd positions (1,3,5,7) weigh 3; even positions (2,4,6) weigh 1. Mirror of EAN-13.
  FOR i IN 1..7 LOOP
    v_sum := v_sum + substr(p_payload, i, 1)::int * CASE WHEN i % 2 = 1 THEN 3 ELSE 1 END;
  END LOOP;
  RETURN (10 - (v_sum % 10)) % 10;   -- outer mod: a sum ending in 0 yields 0, not 10
END;
$$;

CREATE OR REPLACE FUNCTION public.next_product_code()
RETURNS text
LANGUAGE plpgsql VOLATILE
SET search_path = public
AS $$
DECLARE v_payload text;
BEGIN
  v_payload := lpad(nextval('public.product_code_seq')::text, 7, '0');
  RETURN v_payload || public.ean8_check_digit(v_payload)::text;
END;
$$;

-- 15.3 products.barcode: optional free text -> mandatory, generated, globally unique.
--      Column already exists (13.2, `barcode text`) and its Phase 1 index is
--      products_store_barcode_uidx ON (store_id, barcode) WHERE barcode IS NOT NULL.
ALTER TABLE public.products ALTER COLUMN barcode SET DEFAULT public.next_product_code();

-- Runs unconditionally. `products` is verified empty, so this is a no-op today; it is
-- what makes SET NOT NULL safe if that verification is ever wrong. Any surviving Phase 1
-- free-text value is regenerated: it is not a valid code under the new invariant and
-- would fail both the format CHECK and, across stores, the global unique index.
UPDATE public.products
   SET barcode = public.next_product_code()
 WHERE barcode IS NULL OR barcode !~ '^[0-9]{8}$';

ALTER TABLE public.products ALTER COLUMN barcode SET NOT NULL;

DROP INDEX IF EXISTS public.products_store_barcode_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_uidx ON public.products (barcode);

-- Enforces success criterion "the 8th digit validates as a correct EAN-8 check digit"
-- at the DB layer. Caveat: a CHECK calling a user function requires that function to
-- exist first on restore, which the ordering in this file guarantees.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_barcode_ean8_check;
ALTER TABLE public.products ADD  CONSTRAINT products_barcode_ean8_check CHECK (
  barcode ~ '^[0-9]{8}$'
  AND substr(barcode, 8, 1)::int = public.ean8_check_digit(substr(barcode, 1, 7))
);

-- 15.4 Per-branch balances. Composite PK; no surrogate id (see decision).
CREATE TABLE IF NOT EXISTS public.branch_stock (
  store_id      uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  branch_id     uuid NOT NULL,
  product_id    uuid NOT NULL,
  current_stock int  NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  min_stock     int  NOT NULL DEFAULT 0 CHECK (min_stock >= 0),  -- bare column, no behaviour (Phase 7)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, product_id),
  FOREIGN KEY (store_id, branch_id)  REFERENCES public.branches (store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, product_id) REFERENCES public.products (store_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS branch_stock_store_id_idx   ON public.branch_stock (store_id);
CREATE INDEX IF NOT EXISTS branch_stock_product_id_idx ON public.branch_stock (product_id);

-- 15.5 Append-only ledger. sale_item_id has NO FK on purpose: the AFTER DELETE reversal
-- is written once the sale_items row is already gone, and CASCADE would erase the very
-- audit trail this table exists for (Phase 1 precedent: sale_items.product_name).
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  branch_id    uuid NOT NULL,
  product_id   uuid NOT NULL,
  sale_item_id uuid,
  reason text NOT NULL CHECK (reason IN
    ('sale', 'sale_reversal', 'manual_adjustment', 'restock', 'import_ingress')),
  quantity_delta    int NOT NULL CHECK (quantity_delta <> 0),  -- requested (audit)
  applied_delta     int NOT NULL,                              -- actually applied
  resulting_balance int NOT NULL CHECK (resulting_balance >= 0),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, branch_id)  REFERENCES public.branches (store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, product_id) REFERENCES public.products (store_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS stock_movements_store_id_idx ON public.stock_movements (store_id);
CREATE INDEX IF NOT EXISTS stock_movements_branch_product_idx
  ON public.stock_movements (branch_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_sale_item_id_idx
  ON public.stock_movements (sale_item_id) WHERE sale_item_id IS NOT NULL;

-- 15.6 RLS — Shape B verbatim (store-branches design.md:317-336)
ALTER TABLE public.branch_stock    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage branch stock in their branch" ON public.branch_stock;
CREATE POLICY "Users can manage branch stock in their branch" ON public.branch_stock
  FOR ALL TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  )
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  );

-- Append-only: the same boolean expression, split across SELECT/INSERT. No UPDATE or
-- DELETE policy exists, so RLS default-denies both verbs.
DROP POLICY IF EXISTS "Users can read stock movements in their branch" ON public.stock_movements;
CREATE POLICY "Users can read stock movements in their branch" ON public.stock_movements
  FOR SELECT TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  );

DROP POLICY IF EXISTS "Users can insert stock movements in their branch" ON public.stock_movements;
CREATE POLICY "Users can insert stock movements in their branch" ON public.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  );

-- 15.7 sale_items.branch_id — denormalized so the AFTER DELETE reversal survives the
-- sales cascade (see decision). Nullable: pre-store-branches sales have a NULL branch.
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS branch_id uuid;

UPDATE public.sale_items si
   SET branch_id = s.branch_id
  FROM public.sales s
 WHERE s.id = si.sale_id AND si.branch_id IS NULL AND s.branch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_sale_item_branch()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    SELECT s.branch_id INTO NEW.branch_id FROM public.sales s WHERE s.id = NEW.sale_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_sale_item_set_branch ON public.sale_items;
CREATE TRIGGER on_sale_item_set_branch
  BEFORE INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.set_sale_item_branch();

-- 15.8 Sale line item -> branch stock. One function, both directions.
CREATE OR REPLACE FUNCTION public.apply_sale_item_stock()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_item public.sale_items%ROWTYPE;
  v_delta int; v_before int; v_after int; v_prior_applied int;
BEGIN
  IF TG_OP = 'INSERT' THEN v_item := NEW; ELSE v_item := OLD; END IF;

  -- Untracked line (no product resolved) or a pre-branch sale: no-op in both directions.
  IF v_item.product_id IS NULL OR v_item.branch_id IS NULL THEN RETURN NULL; END IF;

  IF TG_OP = 'INSERT' THEN
    v_delta := -v_item.quantity;
  ELSE
    -- Reverse what was APPLIED, not what was requested, so a clamped oversell
    -- restores the true pre-sale balance instead of inventing units.
    SELECT m.applied_delta INTO v_prior_applied
      FROM public.stock_movements m
     WHERE m.sale_item_id = v_item.id AND m.reason = 'sale'
     ORDER BY m.created_at DESC LIMIT 1;
    IF v_prior_applied IS NULL THEN RETURN NULL; END IF;   -- nothing was ever applied
    v_delta := -v_prior_applied;
  END IF;

  IF v_delta = 0 THEN RETURN NULL; END IF;  -- fully clamped sale: nothing to reverse

  -- Create-on-demand at zero AND take the row lock in one atomic statement.
  INSERT INTO public.branch_stock (store_id, branch_id, product_id, current_stock)
  VALUES (v_item.store_id, v_item.branch_id, v_item.product_id, 0)
  ON CONFLICT (branch_id, product_id) DO UPDATE SET updated_at = now()
  RETURNING current_stock INTO v_before;

  UPDATE public.branch_stock
     SET current_stock = GREATEST(v_before + v_delta, 0), updated_at = now()
   WHERE branch_id = v_item.branch_id AND product_id = v_item.product_id
  RETURNING current_stock INTO v_after;

  INSERT INTO public.stock_movements
    (store_id, branch_id, product_id, sale_item_id, reason,
     quantity_delta, applied_delta, resulting_balance)
  VALUES
    (v_item.store_id, v_item.branch_id, v_item.product_id, v_item.id,
     CASE WHEN TG_OP = 'INSERT' THEN 'sale' ELSE 'sale_reversal' END,
     v_delta, v_after - v_before, v_after);

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_sale_item_inserted ON public.sale_items;
CREATE TRIGGER on_sale_item_inserted
  AFTER INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.apply_sale_item_stock();

DROP TRIGGER IF EXISTS on_sale_item_deleted ON public.sale_items;
CREATE TRIGGER on_sale_item_deleted
  AFTER DELETE ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.apply_sale_item_stock();

-- 15.9 Manual/import adjustment: atomic balance change + ledger entry, admin only.
DROP FUNCTION IF EXISTS public.adjust_branch_stock(uuid, uuid, int, text, text);
CREATE FUNCTION public.adjust_branch_stock(
  p_branch_id  uuid,
  p_product_id uuid,
  p_delta      int,
  p_reason     text DEFAULT 'manual_adjustment',
  p_note       text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE v_store_id uuid; v_branch_store uuid; v_before int; v_after int;
BEGIN
  IF public.get_current_user_role() NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Only admins can adjust stock';
  END IF;
  IF p_delta = 0 THEN RAISE EXCEPTION 'Adjustment delta must not be zero'; END IF;
  IF p_reason NOT IN ('manual_adjustment', 'restock', 'import_ingress') THEN
    RAISE EXCEPTION 'Invalid adjustment reason: %', p_reason;
  END IF;

  -- Both reads run under RLS (SECURITY INVOKER), so a cross-tenant id simply finds
  -- nothing and surfaces as "not found" rather than leaking its existence.
  SELECT p.store_id INTO v_store_id  FROM public.products p WHERE p.id = p_product_id;
  IF v_store_id IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

  SELECT b.store_id INTO v_branch_store FROM public.branches b WHERE b.id = p_branch_id;
  IF v_branch_store IS NULL OR v_branch_store <> v_store_id THEN
    RAISE EXCEPTION 'Branch does not belong to this product''s store';
  END IF;

  INSERT INTO public.branch_stock (store_id, branch_id, product_id, current_stock)
  VALUES (v_store_id, p_branch_id, p_product_id, 0)
  ON CONFLICT (branch_id, product_id) DO UPDATE SET updated_at = now()
  RETURNING current_stock INTO v_before;

  UPDATE public.branch_stock
     SET current_stock = GREATEST(v_before + p_delta, 0), updated_at = now()
   WHERE branch_id = p_branch_id AND product_id = p_product_id
  RETURNING current_stock INTO v_after;

  INSERT INTO public.stock_movements
    (store_id, branch_id, product_id, reason,
     quantity_delta, applied_delta, resulting_balance, note)
  VALUES
    (v_store_id, p_branch_id, p_product_id, p_reason,
     p_delta, v_after - v_before, v_after, p_note);

  RETURN v_after;
END;
$$;

-- 15.10 Grants. The sequence grant is REQUIRED: the DEFAULT is evaluated as the
-- inserting (authenticated) role, and nextval() needs USAGE.
GRANT USAGE  ON SEQUENCE public.product_code_seq TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.branch_stock    TO authenticated;
GRANT SELECT, INSERT         ON public.stock_movements TO authenticated;
REVOKE UPDATE, DELETE        ON public.stock_movements FROM authenticated, anon;
REVOKE DELETE                ON public.branch_stock    FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.adjust_branch_stock(uuid, uuid, int, text, text)
  TO authenticated;

-- ROLLBACK (do not run automatically) — reverse of section 15, bottom to top:
-- DROP FUNCTION IF EXISTS public.adjust_branch_stock(uuid, uuid, int, text, text);
-- DROP TRIGGER  IF EXISTS on_sale_item_deleted    ON public.sale_items;
-- DROP TRIGGER  IF EXISTS on_sale_item_inserted   ON public.sale_items;
-- DROP FUNCTION IF EXISTS public.apply_sale_item_stock();
-- DROP TRIGGER  IF EXISTS on_sale_item_set_branch ON public.sale_items;
-- DROP FUNCTION IF EXISTS public.set_sale_item_branch();
-- ALTER TABLE public.sale_items DROP COLUMN IF EXISTS branch_id;
-- DROP TABLE IF EXISTS public.stock_movements CASCADE;
-- DROP TABLE IF EXISTS public.branch_stock    CASCADE;
-- ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_barcode_ean8_check;
-- DROP INDEX IF EXISTS public.products_barcode_uidx;
-- CREATE UNIQUE INDEX IF NOT EXISTS products_store_barcode_uidx
--   ON public.products (store_id, barcode) WHERE barcode IS NOT NULL;
-- ALTER TABLE public.products ALTER COLUMN barcode DROP NOT NULL;
-- ALTER TABLE public.products ALTER COLUMN barcode DROP DEFAULT;
-- DROP FUNCTION IF EXISTS public.next_product_code();
-- DROP FUNCTION IF EXISTS public.ean8_check_digit(text);
-- DROP SEQUENCE IF EXISTS public.product_code_seq;
-- ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_store_id_id_key;
-- ALTER TABLE public.branches DROP CONSTRAINT IF EXISTS branches_store_id_id_key;
-- Generated codes are intentionally left in place — under restored Phase 1 semantics
-- they are valid free text, so nothing is destroyed. Drop order is strict: the
-- check-digit CHECK before the function it calls, triggers before their functions, the
-- branch_id column before the tables that read it, both tables before the constraints
-- they reference.


-- ==============================================================================
-- 16. GRANULAR ROLES (admin | encargado | caja | stock | employee | superadmin)
-- ==============================================================================

-- 16.1 Role ladder (FIRST — nothing else may reference the new values before this)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin','encargado','caja','stock','employee','superadmin'));


-- 16.2 Employee RPCs — assignment matrix
CREATE OR REPLACE FUNCTION public.preload_employee(
  p_email text, p_name text, p_role text, p_store_id uuid, p_branch_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_dummy_id      uuid;
  v_caller_role   text;
  v_caller_branch uuid;
BEGIN
  SELECT role, branch_id INTO v_caller_role, v_caller_branch
  FROM public.profiles WHERE id = auth.uid() AND store_id = p_store_id;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: caller does not belong to this store';
  END IF;

  -- Assignment matrix. 'employee' is deliberately ABSENT from both lists: it stays a
  -- valid stored value (16.1) but is never assignable to a new invite.
  IF v_caller_role = 'admin' THEN
    IF p_role NOT IN ('admin','encargado','caja','stock') THEN
      RAISE EXCEPTION 'Invalid role: must be admin, encargado, caja or stock';
    END IF;
  ELSIF v_caller_role = 'encargado' THEN
    IF p_role NOT IN ('caja','stock') THEN
      RAISE EXCEPTION 'Unauthorized: encargados can only invite caja or stock';
    END IF;
    IF p_branch_id IS DISTINCT FROM v_caller_branch THEN
      RAISE EXCEPTION 'Unauthorized: encargados can only invite into their own branch';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unauthorized: only admins and encargados can preload employees';
  END IF;

  -- Branch-scoped role list. Mirrors profiles_employee_branch_check (16.7) and
  -- update_employee_user below; all three must change together.
  IF p_role IN ('encargado','caja','stock','employee') AND p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required for branch-scoped profiles';
  END IF;

  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches WHERE id = p_branch_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Invalid branch for this store';
  END IF;

  v_dummy_id := gen_random_uuid();

  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
  VALUES (v_dummy_id, null, '{"provider":"email"}'::jsonb, '{}'::jsonb,
          'authenticated', 'authenticated');

  INSERT INTO public.profiles (id, store_id, email, name, role, branch_id)
  VALUES (v_dummy_id, p_store_id, p_email, p_name, p_role,
          CASE WHEN p_role IN ('encargado','caja','stock','employee')
               THEN p_branch_id ELSE NULL END);

  RETURN v_dummy_id;
END;
$$;

DROP FUNCTION IF EXISTS public.update_employee_user(uuid, text, text, uuid);
CREATE FUNCTION public.update_employee_user(
  p_employee_id uuid, p_name text, p_email text, p_branch_id uuid,
  p_role text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_store_id      uuid;
  v_target_role   text;
  v_target_branch uuid;
  v_new_role      text;
  v_caller_role   text;
  v_caller_branch uuid;
BEGIN
  SELECT store_id, role, branch_id INTO v_store_id, v_target_role, v_target_branch
  FROM public.profiles WHERE id = p_employee_id;
  IF v_store_id IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  v_new_role := COALESCE(p_role, v_target_role);

  SELECT role, branch_id INTO v_caller_role, v_caller_branch
  FROM public.profiles WHERE id = auth.uid() AND store_id = v_store_id;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: caller does not belong to this store';
  END IF;

  -- Nobody changes their own role here: prevents a sole admin self-demoting the
  -- store into a locked-out state (mirrors delete_employee_user's self-guard, :339).
  IF p_employee_id = auth.uid() AND v_new_role IS DISTINCT FROM v_caller_role THEN
    RAISE EXCEPTION 'Cannot change your own role';
  END IF;

  -- An Admin's role can NEVER be changed or demoted by any role
  IF v_target_role = 'admin' AND v_new_role <> 'admin' THEN
    RAISE EXCEPTION 'Cannot change or demote the role of an administrator';
  END IF;

  IF v_caller_role = 'admin' THEN
    IF v_new_role NOT IN ('admin','encargado','caja','stock','employee') THEN
      RAISE EXCEPTION 'Invalid role for this store';
    END IF;
  ELSIF v_caller_role = 'encargado' THEN
    IF v_target_role NOT IN ('caja','stock','employee')
       OR v_target_branch IS DISTINCT FROM v_caller_branch THEN
      RAISE EXCEPTION 'Unauthorized: encargados can only edit caja/stock in their branch';
    END IF;
    IF v_new_role NOT IN ('caja','stock') THEN
      RAISE EXCEPTION 'Unauthorized: encargados can only assign caja or stock';
    END IF;
    IF p_branch_id IS DISTINCT FROM v_caller_branch THEN
      RAISE EXCEPTION 'Unauthorized: encargados cannot move a profile to another branch';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unauthorized: only admins and encargados can edit employees';
  END IF;

  IF v_new_role IN ('encargado','caja','stock','employee') AND p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required for branch-scoped profiles';
  END IF;

  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches WHERE id = p_branch_id AND store_id = v_store_id
  ) THEN
    RAISE EXCEPTION 'Invalid branch for this store';
  END IF;

  UPDATE public.profiles
  SET name = p_name,
      email = p_email,
      role  = v_new_role,
      branch_id = CASE WHEN v_new_role IN ('encargado','caja','stock','employee')
                       THEN p_branch_id ELSE NULL END
  WHERE id = p_employee_id;

  UPDATE auth.users SET email = p_email
  WHERE id = p_employee_id AND email IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_employee_user(p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_store_id      uuid;
  v_target_role   text;
  v_target_branch uuid;
  v_caller_role   text;
  v_caller_branch uuid;
BEGIN
  -- Get the store_id, role, and branch_id of the employee being deleted
  SELECT store_id, role, branch_id INTO v_store_id, v_target_role, v_target_branch
  FROM public.profiles
  WHERE id = p_employee_id;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  SELECT role, branch_id INTO v_caller_role, v_caller_branch
  FROM public.profiles WHERE id = auth.uid() AND store_id = v_store_id;

  IF v_caller_role = 'admin' THEN
    NULL;                                    -- any branch in own store
  ELSIF v_caller_role = 'encargado' THEN
    IF v_target_role NOT IN ('caja','stock','employee')
       OR v_target_branch IS DISTINCT FROM v_caller_branch THEN
      RAISE EXCEPTION 'Unauthorized: encargados can only remove caja/stock in their branch';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unauthorized: only admins and encargados can delete employees';
  END IF;

  -- Prevent deleting yourself
  IF p_employee_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete your own user profile';
  END IF;

  -- Detach sales from this employee (preserve history, nullify reference)
  UPDATE public.sales
  SET employee_id = NULL
  WHERE employee_id = p_employee_id;

  -- Delete from auth.users (which cascades to public.profiles)
  DELETE FROM auth.users
  WHERE id = p_employee_id;
END;
$$;


-- 16.3 adjust_branch_stock — minimal widening
CREATE OR REPLACE FUNCTION public.adjust_branch_stock(
  p_branch_id  uuid,
  p_product_id uuid,
  p_delta      int,
  p_reason     text DEFAULT 'manual_adjustment',
  p_note       text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE v_store_id uuid; v_branch_store uuid; v_before int; v_after int;
BEGIN
  IF public.get_current_user_role()
     NOT IN ('admin','superadmin','encargado','stock') THEN
    RAISE EXCEPTION 'Only admins, encargados and stock staff can adjust stock';
  END IF;

  -- Branch ownership, mirroring the p_branch_id/store coherence check already below.
  IF public.get_current_user_role() NOT IN ('admin','superadmin')
     AND p_branch_id IS DISTINCT FROM public.get_current_user_branch_id() THEN
    RAISE EXCEPTION 'Cannot adjust stock for another branch';
  END IF;

  IF p_delta = 0 THEN RAISE EXCEPTION 'Adjustment delta must not be zero'; END IF;
  IF p_reason NOT IN ('manual_adjustment', 'restock', 'import_ingress') THEN
    RAISE EXCEPTION 'Invalid adjustment reason: %', p_reason;
  END IF;

  -- Both reads run under RLS (SECURITY INVOKER), so a cross-tenant id simply finds
  -- nothing and surfaces as "not found" rather than leaking its existence.
  SELECT p.store_id INTO v_store_id  FROM public.products p WHERE p.id = p_product_id;
  IF v_store_id IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

  SELECT b.store_id INTO v_branch_store FROM public.branches b WHERE b.id = p_branch_id;
  IF v_branch_store IS NULL OR v_branch_store <> v_store_id THEN
    RAISE EXCEPTION 'Branch does not belong to this product''s store';
  END IF;

  INSERT INTO public.branch_stock (store_id, branch_id, product_id, current_stock)
  VALUES (v_store_id, p_branch_id, p_product_id, 0)
  ON CONFLICT (branch_id, product_id) DO UPDATE SET updated_at = now()
  RETURNING current_stock INTO v_before;

  UPDATE public.branch_stock
     SET current_stock = GREATEST(v_before + p_delta, 0), updated_at = now()
   WHERE branch_id = p_branch_id AND product_id = p_product_id
  RETURNING current_stock INTO v_after;

  INSERT INTO public.stock_movements
    (store_id, branch_id, product_id, reason,
     quantity_delta, applied_delta, resulting_balance, note)
  VALUES
    (v_store_id, p_branch_id, p_product_id, p_reason,
     p_delta, v_after - v_before, v_after, p_note);

  RETURN v_after;
END;
$$;


-- 16.4 Shape C — store-wide read, role-gated write
DROP POLICY IF EXISTS "Users can manage categories in their store" ON public.categories;

CREATE POLICY "Users can read categories in their store" ON public.categories
  FOR SELECT TO authenticated
  USING (store_id = public.get_current_user_store_id());

CREATE POLICY "Catalog managers can write categories in their store" ON public.categories
  FOR ALL TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND public.get_current_user_role() IN ('admin','superadmin','encargado')
  )
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND public.get_current_user_role() IN ('admin','superadmin','encargado')
  );

DROP POLICY IF EXISTS "Users can manage products in their store" ON public.products;

CREATE POLICY "Users can read products in their store" ON public.products
  FOR SELECT TO authenticated
  USING (store_id = public.get_current_user_store_id());

CREATE POLICY "Catalog managers can write products in their store" ON public.products
  FOR ALL TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND public.get_current_user_role() IN ('admin','superadmin','encargado')
  )
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND public.get_current_user_role() IN ('admin','superadmin','encargado')
  );

DROP POLICY IF EXISTS "Users can manage price rules in their store" ON public.product_price_rules;

CREATE POLICY "Users can read price rules in their store" ON public.product_price_rules
  FOR SELECT TO authenticated
  USING (store_id = public.get_current_user_store_id());

CREATE POLICY "Catalog managers can write price rules in their store" ON public.product_price_rules
  FOR ALL TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND public.get_current_user_role() IN ('admin','superadmin','encargado')
  )
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND public.get_current_user_role() IN ('admin','superadmin','encargado')
  );

-- clients: read policy at :86-89 stays; only the FOR ALL is replaced.
DROP POLICY IF EXISTS "Users can manage clients in the same store" ON public.clients;

CREATE POLICY "Client managers can write clients in their store" ON public.clients
  FOR ALL TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND public.get_current_user_role() IN ('admin','superadmin','encargado')
  )
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND public.get_current_user_role() IN ('admin','superadmin','encargado')
  );

-- Resolved fork #1: caja may add a client mid-sale, never edit or delete one.
CREATE POLICY "Caja can add clients in their store" ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND public.get_current_user_role() IN ('caja','employee')
  );


-- 16.5 Shape D — branch-scoped, verb-split
DROP POLICY IF EXISTS "Users can view sales in the same store"   ON public.sales;
DROP POLICY IF EXISTS "Users can manage sales in the same store" ON public.sales;

CREATE POLICY "Users can read sales in their scope" ON public.sales
  FOR SELECT TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  );

CREATE POLICY "Sellers can create sales in their scope" ON public.sales
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (
        public.get_current_user_role() IN ('encargado','caja','employee')
        AND branch_id = public.get_current_user_branch_id()
      )
    )
  );

CREATE POLICY "Sellers can update sales in their scope" ON public.sales
  FOR UPDATE TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id())
      OR (public.get_current_user_role() IN ('caja','employee')
          AND branch_id = public.get_current_user_branch_id()
          AND employee_id = (select auth.uid()))
    )
  )
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id())
      OR (public.get_current_user_role() IN ('caja','employee')
          AND branch_id = public.get_current_user_branch_id()
          AND employee_id = (select auth.uid()))
    )
  );

CREATE POLICY "Sellers can delete sales in their scope" ON public.sales
  FOR DELETE TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id())
      OR (public.get_current_user_role() IN ('caja','employee')
          AND branch_id = public.get_current_user_branch_id()
          AND employee_id = (select auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Users can manage sale items in their store" ON public.sale_items;

CREATE POLICY "Users can read sale items in their scope" ON public.sale_items
  FOR SELECT TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  );

CREATE POLICY "Sellers can create sale items in their scope" ON public.sale_items
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (
        public.get_current_user_role() IN ('encargado','caja','employee')
        AND branch_id = public.get_current_user_branch_id()
      )
    )
  );

CREATE POLICY "Sellers can update sale items in their scope" ON public.sale_items
  FOR UPDATE TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id())
      OR (public.get_current_user_role() IN ('caja','employee')
          AND branch_id = public.get_current_user_branch_id()
          AND EXISTS (SELECT 1 FROM public.sales s
                       WHERE s.id = sale_items.sale_id
                         AND s.employee_id = (select auth.uid())))
    )
  )
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id())
      OR (public.get_current_user_role() IN ('caja','employee')
          AND branch_id = public.get_current_user_branch_id()
          AND EXISTS (SELECT 1 FROM public.sales s
                       WHERE s.id = sale_items.sale_id
                         AND s.employee_id = (select auth.uid())))
    )
  );

CREATE POLICY "Sellers can delete sale items in their scope" ON public.sale_items
  FOR DELETE TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id())
      OR (public.get_current_user_role() IN ('caja','employee')
          AND branch_id = public.get_current_user_branch_id()
          AND EXISTS (SELECT 1 FROM public.sales s
                       WHERE s.id = sale_items.sale_id
                         AND s.employee_id = (select auth.uid())))
    )
  );


-- 16.6 profiles privilege-escalation fix
DROP POLICY IF EXISTS "Admins can manage profiles in the same store" ON public.profiles;
CREATE POLICY "Admins and encargados can manage profiles in their scope" ON public.profiles
  FOR ALL TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() = 'admin'
      OR (
        public.get_current_user_role() = 'encargado'
        AND branch_id = public.get_current_user_branch_id()
        AND role IN ('caja','stock','employee')
      )
    )
  )
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND CASE public.get_current_user_role()
          WHEN 'admin'     THEN role IN ('admin','encargado','caja','stock','employee')
          WHEN 'encargado' THEN role IN ('caja','stock','employee')
                            AND branch_id = public.get_current_user_branch_id()
          ELSE false
        END
  );


-- 16.7 Generalized branch CHECK — LAST
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_employee_branch_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_employee_branch_check
  CHECK (
    CASE
      WHEN role IN ('encargado','caja','stock','employee') THEN branch_id IS NOT NULL
      WHEN role IN ('admin','superadmin')                  THEN branch_id IS NULL
      ELSE true
    END
  );


-- 16.8 ROLLBACK (do not run automatically) — reverse of section 16, bottom to top:
-- ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_employee_branch_check;
-- ALTER TABLE public.profiles ADD CONSTRAINT profiles_employee_branch_check
--   CHECK (role <> 'employee' OR branch_id IS NOT NULL);
--
-- DROP POLICY IF EXISTS "Admins and encargados can manage profiles in their scope" ON public.profiles;
-- CREATE POLICY "Admins can manage profiles in the same store" ON public.profiles
--   FOR ALL TO authenticated
--   USING (
--     store_id = public.get_current_user_store_id()
--     AND (public.get_current_user_role() = 'admin' OR id = auth.uid())
--   )
--   WITH CHECK (
--     store_id = public.get_current_user_store_id()
--     AND (public.get_current_user_role() = 'admin' OR id = auth.uid())
--   );
--
-- DROP POLICY IF EXISTS "Users can read sale items in their scope" ON public.sale_items;
-- DROP POLICY IF EXISTS "Sellers can create sale items in their scope" ON public.sale_items;
-- DROP POLICY IF EXISTS "Sellers can update sale items in their scope" ON public.sale_items;
-- DROP POLICY IF EXISTS "Sellers can delete sale items in their scope" ON public.sale_items;
-- CREATE POLICY "Users can manage sale items in their store" ON public.sale_items
--   FOR ALL TO authenticated
--   USING (store_id = public.get_current_user_store_id());
--
-- DROP POLICY IF EXISTS "Users can read sales in their scope" ON public.sales;
-- DROP POLICY IF EXISTS "Sellers can create sales in their scope" ON public.sales;
-- DROP POLICY IF EXISTS "Sellers can update sales in their scope" ON public.sales;
-- DROP POLICY IF EXISTS "Sellers can delete sales in their scope" ON public.sales;
-- CREATE POLICY "Users can view sales in the same store" ON public.sales
--   FOR SELECT TO authenticated
--   USING (store_id = public.get_current_user_store_id());
-- CREATE POLICY "Users can manage sales in the same store" ON public.sales
--   FOR ALL TO authenticated
--   USING (store_id = public.get_current_user_store_id());
--
-- DROP POLICY IF EXISTS "Client managers can write clients in their store" ON public.clients;
-- DROP POLICY IF EXISTS "Caja can add clients in their store" ON public.clients;
-- CREATE POLICY "Users can manage clients in the same store" ON public.clients
--   FOR ALL TO authenticated
--   USING (store_id = public.get_current_user_store_id());
--
-- DROP POLICY IF EXISTS "Users can read price rules in their store" ON public.product_price_rules;
-- DROP POLICY IF EXISTS "Catalog managers can write price rules in their store" ON public.product_price_rules;
-- CREATE POLICY "Users can manage price rules in their store" ON public.product_price_rules
--   FOR ALL TO authenticated
--   USING (store_id = public.get_current_user_store_id());
--
-- DROP POLICY IF EXISTS "Users can read products in their store" ON public.products;
-- DROP POLICY IF EXISTS "Catalog managers can write products in their store" ON public.products;
-- CREATE POLICY "Users can manage products in their store" ON public.products
--   FOR ALL TO authenticated
--   USING (store_id = public.get_current_user_store_id());
--
-- DROP POLICY IF EXISTS "Users can read categories in their store" ON public.categories;
-- DROP POLICY IF EXISTS "Catalog managers can write categories in their store" ON public.categories;
-- CREATE POLICY "Users can manage categories in their store" ON public.categories
--   FOR ALL TO authenticated
--   USING (store_id = public.get_current_user_store_id());
--
-- (adjust_branch_stock rollback: restore 15.9 definition with 'admin', 'superadmin' check)
-- (delete_employee_user rollback: restore 9 definition)
-- (update_employee_user rollback: DROP 5-arg form; restore 14.7 4-arg definition)
-- (preload_employee rollback: restore 14.6 definition)
--
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM public.profiles WHERE role IN ('encargado','caja','stock')) THEN
--     RAISE EXCEPTION 'Reassign encargado/caja/stock profiles before rolling back';
--   END IF;
-- END $$;
-- ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
-- ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
--   CHECK (role IN ('admin','employee','superadmin'));


-- ==============================================================================
-- 17. CASH REGISTER — per-branch caja sessions + manual cash ledger
-- ==============================================================================

-- 17.1 cash_sessions. One open session per branch is a DATABASE invariant.
CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL,
  opened_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  opening_amount  numeric(10,2) NOT NULL DEFAULT 0 CHECK (opening_amount >= 0),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  closed_at       timestamptz,
  counted_amount  numeric(10,2) CHECK (counted_amount >= 0),
  expected_amount numeric(10,2),
  discrepancy     numeric(10,2),
  FOREIGN KEY (store_id, branch_id) REFERENCES public.branches (store_id, id) ON DELETE CASCADE,
  CONSTRAINT cash_sessions_closed_shape CHECK (
    (status = 'open'   AND closed_at IS NULL AND counted_amount IS NULL
                       AND expected_amount IS NULL AND discrepancy IS NULL)
 OR (status = 'closed' AND closed_at IS NOT NULL AND counted_amount IS NOT NULL
                       AND expected_amount IS NOT NULL AND discrepancy IS NOT NULL)
  )
);

-- THE invariant: at most one open session per branch.
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open_per_branch_idx
  ON public.cash_sessions (branch_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS cash_sessions_store_id_idx ON public.cash_sessions (store_id);
CREATE INDEX IF NOT EXISTS cash_sessions_branch_opened_idx
  ON public.cash_sessions (branch_id, opened_at DESC);

-- Coherence key (section 15.1 pattern, :737-743): a sale's session is always
-- at the sale's own branch, so the RLS subquery in 17.8 can never miss it.
ALTER TABLE public.cash_sessions
  DROP CONSTRAINT IF EXISTS cash_sessions_branch_id_key;
ALTER TABLE public.cash_sessions
  ADD CONSTRAINT cash_sessions_branch_id_key UNIQUE (branch_id, id);

-- 17.2 cash_movements. Manual entries ONLY — sale-driven cash is derived
-- (join sales WHERE payment_method='cash'), never duplicated here.
CREATE TABLE IF NOT EXISTS public.cash_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id uuid NOT NULL REFERENCES public.cash_sessions(id) ON DELETE CASCADE,
  store_id        uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL,
  type            text NOT NULL CHECK (type IN ('cash_in','cash_out')),
  amount          numeric(10,2) NOT NULL CHECK (amount > 0),
  reason          text NOT NULL CHECK (btrim(reason) <> ''),
  note            text,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, branch_id) REFERENCES public.branches (store_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS cash_movements_session_idx
  ON public.cash_movements (cash_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cash_movements_store_id_idx ON public.cash_movements (store_id);

-- 17.3 RLS — Shape B verbatim (:851-866), split across SELECT/INSERT exactly like
-- stock_movements (:868-890). No UPDATE or DELETE policy exists on either table,
-- so RLS default-denies both verbs; 17.7 revokes the privilege as well.
ALTER TABLE public.cash_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read cash sessions in their branch" ON public.cash_sessions;
CREATE POLICY "Users can read cash sessions in their branch" ON public.cash_sessions
  FOR SELECT TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  );

-- Opening a session is a plain INSERT (decision D1). opened_by is pinned to the
-- caller so an open can never be attributed to someone else.
DROP POLICY IF EXISTS "Operators can open cash sessions in their branch" ON public.cash_sessions;
CREATE POLICY "Operators can open cash sessions in their branch" ON public.cash_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND status = 'open'
    AND opened_by = (select auth.uid())
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR (
        public.get_current_user_role() IN ('encargado','caja','employee')
        AND branch_id = public.get_current_user_branch_id()
      )
    )
  );

DROP POLICY IF EXISTS "Users can read cash movements in their branch" ON public.cash_movements;
CREATE POLICY "Users can read cash movements in their branch" ON public.cash_movements
  FOR SELECT TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  );

DROP POLICY IF EXISTS "Users can insert cash movements in their branch" ON public.cash_movements;
CREATE POLICY "Users can insert cash movements in their branch" ON public.cash_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND created_by = (select auth.uid())
    AND (
      public.get_current_user_role() IN ('admin', 'superadmin')
      OR branch_id = public.get_current_user_branch_id()
    )
  );

-- 17.4 sales.cash_session_id — nullable, additive. A sale made with no open
-- session lands NULL, exactly like sale_items.product_id for an unmatched name.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cash_session_id uuid;
CREATE INDEX IF NOT EXISTS sales_cash_session_id_idx
  ON public.sales (cash_session_id) WHERE cash_session_id IS NOT NULL;

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_cash_session_branch_fkey;
ALTER TABLE public.sales ADD CONSTRAINT sales_cash_session_branch_fkey
  FOREIGN KEY (branch_id, cash_session_id)
  REFERENCES public.cash_sessions (branch_id, id) ON DELETE SET NULL;

-- 17.5 Stale-attach guard (D5). Never blocks a sale: an id that is missing,
-- foreign, or already closed degrades to NULL (unattributed).
CREATE OR REPLACE FUNCTION public.enforce_sale_cash_session()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF NEW.cash_session_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cash_sessions cs
       WHERE cs.id = NEW.cash_session_id
         AND cs.status = 'open'
         AND cs.branch_id IS NOT DISTINCT FROM NEW.branch_id
    ) THEN
      NEW.cash_session_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_sale_set_cash_session ON public.sales;
CREATE TRIGGER on_sale_set_cash_session
  BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.enforce_sale_cash_session();

-- 17.6 Close = the ONLY mutation path for cash_sessions (D1, D2). SECURITY
-- DEFINER because the caller holds no UPDATE grant, so expected_amount and
-- discrepancy cannot be forged from the client. Authorization is done in the
-- body, mirroring preload_employee (:1086) / the :606 branch-ownership check.
DROP FUNCTION IF EXISTS public.close_cash_session(uuid, numeric);
CREATE FUNCTION public.close_cash_session(
  p_session_id     uuid,
  p_counted_amount numeric
)
RETURNS public.cash_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role        text := public.get_current_user_role();
  v_store_id    uuid := public.get_current_user_store_id();
  v_branch_id   uuid := public.get_current_user_branch_id();
  v_session     public.cash_sessions;
  v_cash_sales  numeric(10,2);
  v_cash_in     numeric(10,2);
  v_cash_out    numeric(10,2);
  v_expected    numeric(10,2);
BEGIN
  IF p_counted_amount IS NULL OR p_counted_amount < 0 THEN
    RAISE EXCEPTION 'A non-negative counted amount is required';
  END IF;

  -- FOR UPDATE serializes two concurrent closes of the same session.
  SELECT * INTO v_session FROM public.cash_sessions
   WHERE id = p_session_id FOR UPDATE;

  -- Same message for "absent" and "other tenant" so existence never leaks.
  IF v_session.id IS NULL OR v_session.store_id IS DISTINCT FROM v_store_id THEN
    RAISE EXCEPTION 'Cash session not found';
  END IF;

  IF v_role IN ('admin','superadmin') THEN
    NULL;  -- store-wide, any branch of their store
  ELSIF v_role IN ('encargado','caja','employee')
        AND v_session.branch_id = v_branch_id THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Not authorized to close this cash session';
  END IF;

  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'Cash session is already closed';
  END IF;

  -- sales.total_amount is numeric(10,2); combined payments are split one row
  -- per method (sales-form.tsx:344-402), so this sum is exact — there is no
  -- partial-cash amount to apportion.
  SELECT COALESCE(SUM(s.total_amount), 0) INTO v_cash_sales
    FROM public.sales s
   WHERE s.cash_session_id = p_session_id
     AND s.payment_method = 'cash';

  SELECT COALESCE(SUM(m.amount) FILTER (WHERE m.type = 'cash_in'),  0),
         COALESCE(SUM(m.amount) FILTER (WHERE m.type = 'cash_out'), 0)
    INTO v_cash_in, v_cash_out
    FROM public.cash_movements m
   WHERE m.cash_session_id = p_session_id;

  v_expected := v_session.opening_amount + v_cash_sales + v_cash_in - v_cash_out;

  UPDATE public.cash_sessions
     SET status          = 'closed',
         closed_by       = auth.uid(),
         closed_at       = now(),
         counted_amount  = p_counted_amount,
         expected_amount = v_expected,
         discrepancy     = p_counted_amount - v_expected
   WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;

-- 17.7 Grants. Append-only from the client on both tables; close is RPC-only.
GRANT SELECT, INSERT  ON public.cash_sessions  TO authenticated;
GRANT SELECT, INSERT  ON public.cash_movements TO authenticated;
REVOKE UPDATE, DELETE ON public.cash_sessions  FROM authenticated, anon;
REVOKE UPDATE, DELETE ON public.cash_movements FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.close_cash_session(uuid, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.close_cash_session(uuid, numeric) TO authenticated;

-- 17.8 Post-close immutability. Delta vs 16.5 is ONE clause, on the non-admin
-- arms only. admin/superadmin stay unconditional (resolved Q1). Every existing
-- condition below is preserved byte-for-byte from :1440-1477 / :1504-1547.
DROP POLICY IF EXISTS "Sellers can update sales in their scope" ON public.sales;
CREATE POLICY "Sellers can update sales in their scope" ON public.sales
  FOR UPDATE TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id()
          AND (cash_session_id IS NULL
               OR EXISTS (SELECT 1 FROM public.cash_sessions cs
                           WHERE cs.id = sales.cash_session_id
                             AND cs.status = 'open')))
      OR (public.get_current_user_role() IN ('caja','employee')
          AND branch_id = public.get_current_user_branch_id()
          AND employee_id = (select auth.uid())
          AND (cash_session_id IS NULL
               OR EXISTS (SELECT 1 FROM public.cash_sessions cs
                           WHERE cs.id = sales.cash_session_id
                             AND cs.status = 'open')))
    )
  )
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id()
          AND (cash_session_id IS NULL
               OR EXISTS (SELECT 1 FROM public.cash_sessions cs
                           WHERE cs.id = sales.cash_session_id
                             AND cs.status = 'open')))
      OR (public.get_current_user_role() IN ('caja','employee')
          AND branch_id = public.get_current_user_branch_id()
          AND employee_id = (select auth.uid())
          AND (cash_session_id IS NULL
               OR EXISTS (SELECT 1 FROM public.cash_sessions cs
                           WHERE cs.id = sales.cash_session_id
                             AND cs.status = 'open')))
    )
  );

DROP POLICY IF EXISTS "Sellers can delete sales in their scope" ON public.sales;
CREATE POLICY "Sellers can delete sales in their scope" ON public.sales
  FOR DELETE TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id()
          AND (cash_session_id IS NULL
               OR EXISTS (SELECT 1 FROM public.cash_sessions cs
                           WHERE cs.id = sales.cash_session_id
                             AND cs.status = 'open')))
      OR (public.get_current_user_role() IN ('caja','employee')
          AND branch_id = public.get_current_user_branch_id()
          AND employee_id = (select auth.uid())
          AND (cash_session_id IS NULL
               OR EXISTS (SELECT 1 FROM public.cash_sessions cs
                           WHERE cs.id = sales.cash_session_id
                             AND cs.status = 'open')))
    )
  );

-- sale_items reaches the session through its EXISTS join to sales, which the
-- caja/employee arm already carries; the encargado arm gains that same join.
DROP POLICY IF EXISTS "Sellers can update sale items in their scope" ON public.sale_items;
CREATE POLICY "Sellers can update sale items in their scope" ON public.sale_items
  FOR UPDATE TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id()
          AND NOT EXISTS (SELECT 1 FROM public.sales s
                           JOIN public.cash_sessions cs ON cs.id = s.cash_session_id
                          WHERE s.id = sale_items.sale_id
                            AND cs.status = 'closed'))
      OR (public.get_current_user_role() IN ('caja','employee')
          AND branch_id = public.get_current_user_branch_id()
          AND EXISTS (SELECT 1 FROM public.sales s
                       WHERE s.id = sale_items.sale_id
                         AND s.employee_id = (select auth.uid())
                         AND (s.cash_session_id IS NULL
                              OR EXISTS (SELECT 1 FROM public.cash_sessions cs
                                          WHERE cs.id = s.cash_session_id
                                            AND cs.status = 'open'))))
    )
  )
  WITH CHECK (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id()
          AND NOT EXISTS (SELECT 1 FROM public.sales s
                           JOIN public.cash_sessions cs ON cs.id = s.cash_session_id
                          WHERE s.id = sale_items.sale_id
                            AND cs.status = 'closed'))
      OR (public.get_current_user_role() IN ('caja','employee')
          AND branch_id = public.get_current_user_branch_id()
          AND EXISTS (SELECT 1 FROM public.sales s
                       WHERE s.id = sale_items.sale_id
                         AND s.employee_id = (select auth.uid())
                         AND (s.cash_session_id IS NULL
                              OR EXISTS (SELECT 1 FROM public.cash_sessions cs
                                          WHERE cs.id = s.cash_session_id
                                            AND cs.status = 'open'))))
    )
  );

DROP POLICY IF EXISTS "Sellers can delete sale items in their scope" ON public.sale_items;
CREATE POLICY "Sellers can delete sale items in their scope" ON public.sale_items
  FOR DELETE TO authenticated
  USING (
    store_id = public.get_current_user_store_id()
    AND (
      public.get_current_user_role() IN ('admin','superadmin')
      OR (public.get_current_user_role() = 'encargado'
          AND branch_id = public.get_current_user_branch_id()
          AND NOT EXISTS (SELECT 1 FROM public.sales s
                           JOIN public.cash_sessions cs ON cs.id = s.cash_session_id
                          WHERE s.id = sale_items.sale_id
                            AND cs.status = 'closed'))
      OR (public.get_current_user_role() IN ('caja','employee')
          AND branch_id = public.get_current_user_branch_id()
          AND EXISTS (SELECT 1 FROM public.sales s
                       WHERE s.id = sale_items.sale_id
                         AND s.employee_id = (select auth.uid())
                         AND (s.cash_session_id IS NULL
                              OR EXISTS (SELECT 1 FROM public.cash_sessions cs
                                          WHERE cs.id = s.cash_session_id
                                            AND cs.status = 'open'))))
    )
  );


-- 17.9 ROLLBACK (do not run automatically) — reverse of section 17, bottom to top:
-- DROP POLICY IF EXISTS "Sellers can update sales in their scope" ON public.sales;
-- CREATE POLICY "Sellers can update sales in their scope" ON public.sales
--   FOR UPDATE TO authenticated
--   USING (
--     store_id = public.get_current_user_store_id()
--     AND (
--       public.get_current_user_role() IN ('admin','superadmin')
--       OR (public.get_current_user_role() = 'encargado'
--           AND branch_id = public.get_current_user_branch_id())
--       OR (public.get_current_user_role() IN ('caja','employee')
--           AND branch_id = public.get_current_user_branch_id()
--           AND employee_id = (select auth.uid()))
--     )
--   )
--   WITH CHECK (
--     store_id = public.get_current_user_store_id()
--     AND (
--       public.get_current_user_role() IN ('admin','superadmin')
--       OR (public.get_current_user_role() = 'encargado'
--           AND branch_id = public.get_current_user_branch_id())
--       OR (public.get_current_user_role() IN ('caja','employee')
--           AND branch_id = public.get_current_user_branch_id()
--           AND employee_id = (select auth.uid()))
--     )
--   );
--
-- DROP POLICY IF EXISTS "Sellers can delete sales in their scope" ON public.sales;
-- CREATE POLICY "Sellers can delete sales in their scope" ON public.sales
--   FOR DELETE TO authenticated
--   USING (
--     store_id = public.get_current_user_store_id()
--     AND (
--       public.get_current_user_role() IN ('admin','superadmin')
--       OR (public.get_current_user_role() = 'encargado'
--           AND branch_id = public.get_current_user_branch_id())
--       OR (public.get_current_user_role() IN ('caja','employee')
--           AND branch_id = public.get_current_user_branch_id()
--           AND employee_id = (select auth.uid()))
--     )
--   );
--
-- DROP POLICY IF EXISTS "Sellers can update sale items in their scope" ON public.sale_items;
-- CREATE POLICY "Sellers can update sale items in their scope" ON public.sale_items
--   FOR UPDATE TO authenticated
--   USING (
--     store_id = public.get_current_user_store_id()
--     AND (
--       public.get_current_user_role() IN ('admin','superadmin')
--       OR (public.get_current_user_role() = 'encargado'
--           AND branch_id = public.get_current_user_branch_id())
--       OR (public.get_current_user_role() IN ('caja','employee')
--           AND branch_id = public.get_current_user_branch_id()
--           AND EXISTS (SELECT 1 FROM public.sales s
--                        WHERE s.id = sale_items.sale_id
--                          AND s.employee_id = (select auth.uid())))
--     )
--   )
--   WITH CHECK (
--     store_id = public.get_current_user_store_id()
--     AND (
--       public.get_current_user_role() IN ('admin','superadmin')
--       OR (public.get_current_user_role() = 'encargado'
--           AND branch_id = public.get_current_user_branch_id())
--       OR (public.get_current_user_role() IN ('caja','employee')
--           AND branch_id = public.get_current_user_branch_id()
--           AND EXISTS (SELECT 1 FROM public.sales s
--                        WHERE s.id = sale_items.sale_id
--                          AND s.employee_id = (select auth.uid())))
--     )
--   );
--
-- DROP POLICY IF EXISTS "Sellers can delete sale items in their scope" ON public.sale_items;
-- CREATE POLICY "Sellers can delete sale items in their scope" ON public.sale_items
--   FOR DELETE TO authenticated
--   USING (
--     store_id = public.get_current_user_store_id()
--     AND (
--       public.get_current_user_role() IN ('admin','superadmin')
--       OR (public.get_current_user_role() = 'encargado'
--           AND branch_id = public.get_current_user_branch_id())
--       OR (public.get_current_user_role() IN ('caja','employee')
--           AND branch_id = public.get_current_user_branch_id()
--           AND EXISTS (SELECT 1 FROM public.sales s
--                        WHERE s.id = sale_items.sale_id
--                          AND s.employee_id = (select auth.uid())))
--     )
--   );
--
-- DROP FUNCTION IF EXISTS public.close_cash_session(uuid, numeric);
--
-- DROP TRIGGER IF EXISTS on_sale_set_cash_session ON public.sales;
-- DROP FUNCTION IF EXISTS public.enforce_sale_cash_session();
--
-- ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_cash_session_branch_fkey;
-- DROP INDEX IF EXISTS public.sales_cash_session_id_idx;
-- ALTER TABLE public.sales DROP COLUMN IF EXISTS cash_session_id;
--
-- DROP TABLE IF EXISTS public.cash_movements CASCADE;
-- DROP TABLE IF EXISTS public.cash_sessions CASCADE;

-- ==============================================================================
-- 18. STORE ANALYTICS — read-only aggregation (Phase 7)
-- ==============================================================================
-- Nothing here mutates. Every object is SECURITY INVOKER so the existing
-- policies (§15.6 branch_stock, §16.4 products, §16.5 sales/sale_items,
-- §17.3 cash_sessions) do the scoping. The ONE exception is 18.4, which must
-- re-derive it by hand — see the comment there.

-- 18.1 Indexes. sales has sales_branch_id_idx (:580) and, via schema drift
-- not reflected earlier in this file, an existing idx_sales_store_created
-- (store_id, created_at DESC) already covers the store-wide period scan used
-- by 18.4's per-branch LATERAL join. Only the branch-scoped composite is
-- actually missing — creating a second (store_id, created_at) index under a
-- new name would just duplicate idx_sales_store_created.
CREATE INDEX IF NOT EXISTS sales_branch_created_idx
  ON public.sales (branch_id, created_at DESC);
-- sale_items.branch_id (§15.7) has no index; its SELECT policy filters on it.
CREATE INDEX IF NOT EXISTS sale_items_branch_id_idx
  ON public.sale_items (branch_id);
-- cash_sessions_branch_opened_idx (:1694) indexes opened_at; 18.5 filters closed_at.
CREATE INDEX IF NOT EXISTS cash_sessions_branch_closed_idx
  ON public.cash_sessions (branch_id, closed_at DESC) WHERE status = 'closed';

-- 18.2 Low-stock alerts. WITHOUT security_invoker a view runs with the VIEW
-- OWNER's rights (postgres, which bypasses RLS) and would expose every store.
-- min_stock is NOT NULL DEFAULT 0 (:811), so "not configured" is exactly 0 —
-- there is no NULL arm to handle.
DROP VIEW IF EXISTS public.analytics_low_stock;
CREATE VIEW public.analytics_low_stock
WITH (security_invoker = true) AS
SELECT bs.store_id,
       bs.branch_id,
       b.name  AS branch_name,
       bs.product_id,
       p.name  AS product_name,
       p.barcode,
       bs.current_stock,
       bs.min_stock,
       (bs.min_stock - bs.current_stock) AS deficit
  FROM public.branch_stock bs
  JOIN public.products p ON p.id = bs.product_id
  JOIN public.branches b ON b.id = bs.branch_id
 WHERE bs.min_stock > 0
   AND bs.current_stock <= bs.min_stock
   AND p.is_active;

-- 18.3 Product ranking + margin. sale_items' Shape D SELECT policy (:1481)
-- already limits an encargado to their branch; p_branch_id can only narrow.
-- Legacy free-text lines (product_id IS NULL, pre-P1) are excluded: they have
-- no product to rank or price.
DROP FUNCTION IF EXISTS public.analytics_product_ranking(timestamptz, timestamptz, uuid);
CREATE FUNCTION public.analytics_product_ranking(
  p_from      timestamptz,
  p_to        timestamptz,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  product_id       uuid,
  product_name     text,
  units_sold       bigint,
  revenue          numeric,
  margin_estimated numeric,
  margin_realized  numeric
)
LANGUAGE sql SECURITY INVOKER STABLE SET search_path = public
AS $$
  SELECT si.product_id,
         MAX(COALESCE(p.name, si.product_name)),
         SUM(si.quantity)::bigint,
         SUM(si.subtotal),
         SUM(si.quantity * (p.sale_price - p.purchase_price)),
         SUM(si.subtotal - si.quantity * p.purchase_price)
    FROM public.sale_items si
    JOIN public.sales    s ON s.id = si.sale_id
    JOIN public.products p ON p.id = si.product_id
   WHERE s.created_at >= p_from
     AND s.created_at <  p_to
     AND si.product_id IS NOT NULL
     AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
   GROUP BY si.product_id;
$$;

-- 18.4 Branch comparison. THE ONE PLACE that re-derives scoping by hand.
-- branches is store-wide readable (§14.2 :550-553), so driving FROM it would
-- hand an encargado one zero-row per sibling branch: RLS zeroes the NUMBERS
-- but does not hide the BRANCHES. The explicit predicate below is what
-- enforces the resolved decision "encargado sees ONLY their own branch".
-- sales_count replicates groupSales()'s ref-code grouping (salesHelper.ts:144)
-- so combined payments count as ONE transaction, matching the Dashboard.
DROP FUNCTION IF EXISTS public.analytics_branch_comparison(timestamptz, timestamptz);
CREATE FUNCTION public.analytics_branch_comparison(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS TABLE (
  branch_id   uuid,
  branch_name text,
  revenue     numeric,
  sales_count bigint,
  stock_units bigint
)
LANGUAGE sql SECURITY INVOKER STABLE SET search_path = public
AS $$
  SELECT b.id,
         b.name,
         COALESCE(sa.revenue, 0),
         COALESCE(sa.sales_count, 0),
         COALESCE(st.stock_units, 0)
    FROM public.branches b
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(s.total_amount), 0) AS revenue,
             COUNT(DISTINCT COALESCE(
               substring(s.description from 'Ref:\s*#([A-Za-z0-9-]+)'),
               s.id::text))::bigint           AS sales_count
        FROM public.sales s
       WHERE s.branch_id = b.id
         AND s.created_at >= p_from
         AND s.created_at <  p_to
    ) sa ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(bs.current_stock), 0)::bigint AS stock_units
        FROM public.branch_stock bs
       WHERE bs.branch_id = b.id
    ) st ON true
   WHERE b.is_active
     AND b.store_id = public.get_current_user_store_id()
     AND (
       public.get_current_user_role() IN ('admin','superadmin')
       OR b.id = public.get_current_user_branch_id()
     )
   ORDER BY 3 DESC;
$$;

-- 18.5 Cash discrepancy trend. Returns one row per CLOSED session rather than
-- a pre-grouped aggregate: cardinality is bounded (~1-2 sessions/branch/day,
-- so <100 rows for a 30-day window) and the panel needs per-session points for
-- the time series AND a per-cashier rollup from the same fetch.
DROP FUNCTION IF EXISTS public.analytics_cash_discrepancy(timestamptz, timestamptz, uuid);
CREATE FUNCTION public.analytics_cash_discrepancy(
  p_from      timestamptz,
  p_to        timestamptz,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  session_id      uuid,
  branch_id       uuid,
  branch_name     text,
  closed_at       timestamptz,
  closed_by       uuid,
  cashier_name    text,
  expected_amount numeric,
  counted_amount  numeric,
  discrepancy     numeric
)
LANGUAGE sql SECURITY INVOKER STABLE SET search_path = public
AS $$
  SELECT cs.id, cs.branch_id, b.name, cs.closed_at, cs.closed_by,
         COALESCE(pr.name, pr.email, 'Sin nombre'),
         cs.expected_amount, cs.counted_amount, cs.discrepancy
    FROM public.cash_sessions cs
    JOIN public.branches b  ON b.id  = cs.branch_id
    LEFT JOIN public.profiles pr ON pr.id = cs.closed_by
   WHERE cs.status = 'closed'
     AND cs.closed_at >= p_from
     AND cs.closed_at <  p_to
     AND (p_branch_id IS NULL OR cs.branch_id = p_branch_id)
   ORDER BY cs.closed_at;
$$;

-- 18.6 Grants. Read-only surface, revoke-then-grant per §17.7 (:1896-1902).
-- security_invoker views also require the CALLER to hold SELECT on the base
-- tables — branch_stock has it (:1036), products/sales/sale_items via
-- Supabase's default privileges for `authenticated`.
GRANT SELECT ON public.analytics_low_stock TO authenticated;
REVOKE ALL    ON public.analytics_low_stock FROM anon;
REVOKE EXECUTE ON FUNCTION public.analytics_product_ranking(timestamptz, timestamptz, uuid)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.analytics_product_ranking(timestamptz, timestamptz, uuid)   TO authenticated;
REVOKE EXECUTE ON FUNCTION public.analytics_branch_comparison(timestamptz, timestamptz)       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.analytics_branch_comparison(timestamptz, timestamptz)       TO authenticated;
REVOKE EXECUTE ON FUNCTION public.analytics_cash_discrepancy(timestamptz, timestamptz, uuid)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.analytics_cash_discrepancy(timestamptz, timestamptz, uuid)  TO authenticated;

-- 18.7 ROLLBACK (do not run automatically) — reverse of section 18, bottom to top:
-- DROP FUNCTION IF EXISTS public.analytics_cash_discrepancy(timestamptz, timestamptz, uuid);
-- DROP FUNCTION IF EXISTS public.analytics_branch_comparison(timestamptz, timestamptz);
-- DROP FUNCTION IF EXISTS public.analytics_product_ranking(timestamptz, timestamptz, uuid);
-- DROP VIEW     IF EXISTS public.analytics_low_stock;
-- DROP INDEX    IF EXISTS public.cash_sessions_branch_closed_idx;
-- DROP INDEX    IF EXISTS public.sale_items_branch_id_idx;
-- DROP INDEX    IF EXISTS public.sales_branch_created_idx;
-- No table, column, or row is touched in either direction; min_stock returns
-- to inert. The indexes are safe to keep if only the views are rolled back.

-- 19. STORE ANALYTICS — sales trend + category comparison (Phase 7 follow-up)

-- 19.1 Daily sales trend. Driven FROM sales (already branch-scoped via RLS
-- for encargado, same as analytics_branch_comparison's per-branch LATERAL),
-- so no manual predicate is needed here — unlike 18.4, this does not drive
-- FROM the store-wide-readable `branches` table.
DROP FUNCTION IF EXISTS public.analytics_sales_trend(timestamptz, timestamptz, uuid);
CREATE FUNCTION public.analytics_sales_trend(
  p_from      timestamptz,
  p_to        timestamptz,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  day     date,
  revenue numeric
)
LANGUAGE sql SECURITY INVOKER STABLE SET search_path = public
AS $$
  SELECT date_trunc('day', s.created_at)::date AS day,
         SUM(s.total_amount) AS revenue
    FROM public.sales s
   WHERE s.created_at >= p_from
     AND s.created_at <  p_to
     AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
   GROUP BY 1
   ORDER BY 1;
$$;

-- 19.2 Category comparison. Driven FROM sale_items (already branch-scoped
-- via its own Shape D SELECT policy, same inheritance reasoning as
-- analytics_product_ranking in 18.3), LEFT JOIN categories since
-- products.category_id is nullable (ON DELETE SET NULL) — uncategorized
-- products roll up under 'Sin categoría'.
DROP FUNCTION IF EXISTS public.analytics_category_comparison(timestamptz, timestamptz, uuid);
CREATE FUNCTION public.analytics_category_comparison(
  p_from      timestamptz,
  p_to        timestamptz,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  category_id   uuid,
  category_name text,
  revenue       numeric,
  units_sold    bigint
)
LANGUAGE sql SECURITY INVOKER STABLE SET search_path = public
AS $$
  SELECT c.id,
         COALESCE(c.name, 'Sin categoría'),
         SUM(si.subtotal),
         SUM(si.quantity)::bigint
    FROM public.sale_items si
    JOIN public.sales    s ON s.id = si.sale_id
    JOIN public.products p ON p.id = si.product_id
    LEFT JOIN public.categories c ON c.id = p.category_id
   WHERE s.created_at >= p_from
     AND s.created_at <  p_to
     AND si.product_id IS NOT NULL
     AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
   GROUP BY c.id, c.name
   ORDER BY 3 DESC;
$$;

-- 19.3 Grants.
REVOKE EXECUTE ON FUNCTION public.analytics_sales_trend(timestamptz, timestamptz, uuid)        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.analytics_sales_trend(timestamptz, timestamptz, uuid)        TO authenticated;
REVOKE EXECUTE ON FUNCTION public.analytics_category_comparison(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.analytics_category_comparison(timestamptz, timestamptz, uuid) TO authenticated;

-- 19.4 ROLLBACK (do not run automatically):
-- DROP FUNCTION IF EXISTS public.analytics_category_comparison(timestamptz, timestamptz, uuid);
-- DROP FUNCTION IF EXISTS public.analytics_sales_trend(timestamptz, timestamptz, uuid);
-- No table, column, or row is touched in either direction.
-- Applied to production by the orchestrator on 2026-08-30.

-- ==============================================================================
-- 20. branch_stock.min_stock default changed 0 -> 8 (Phase 7 follow-up)
-- ==============================================================================
-- min_stock (§15.6) was never configurable anywhere in the UI before this
-- follow-up patch and defaulted to 0 ("not configured") for every row, which
-- made analytics_low_stock (§18.2) permanently empty. Per explicit user
-- request: seed every existing branch_stock row to 8 and change the column
-- default so newly-created rows (new product x branch pairs) start at 8
-- instead of 0. Purely a data/default change — no new column, no RLS change.
-- Every row remains individually editable afterward via StockAdjustDialog.
ALTER TABLE public.branch_stock ALTER COLUMN min_stock SET DEFAULT 8;
UPDATE public.branch_stock SET min_stock = 8;

-- 20.1 ROLLBACK (do not run automatically):
-- ALTER TABLE public.branch_stock ALTER COLUMN min_stock SET DEFAULT 0;
-- Rolling back the seeded values themselves is not meaningful (they were all
-- 0/unconfigured before, indistinguishable from any admin-edited value of 0
-- entered afterward) - only the DEFAULT is reversible with confidence.

-- ==============================================================================
-- 21. QA AUDIT (Phase 8) — deferred security/data-integrity debt, closed out
-- ==============================================================================
-- Both items were flagged by the qa-audit exploration as low-severity,
-- deliberately-deferred debt, then closed on explicit user request.

-- 21.1 Explicit REVOKE EXECUTE for the three employee-management RPCs. Every
-- SECURITY DEFINER function from stock-phase2 onward (adjust_branch_stock,
-- close_cash_session, the analytics functions) already gets this treatment;
-- these three (from the original P1-era auth work) never did, leaving them
-- directly callable by anon/PUBLIC at the SQL level (no confirmed exploit —
-- their internal auth.uid()-based checks fail closed for an unauthenticated
-- caller — but inconsistent with this codebase's own established pattern).
REVOKE EXECUTE ON FUNCTION public.delete_employee_user(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_employee_user(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_employee_user(uuid, text, text, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_employee_user(uuid, text, text, uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.preload_employee(text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.preload_employee(text, text, text, uuid, uuid) TO authenticated;

-- 21.2 Protect the append-only audit ledgers (stock_movements, cash_movements,
-- both explicitly documented as immutable history) from ever being silently
-- destroyed by a branch hard-delete. branch_stock/cash_sessions/profiles/
-- sales all keep their existing ON DELETE behavior unchanged — only the two
-- audit-ledger tables' composite branch FK moves from CASCADE to RESTRICT.
-- Dormant fix: no code path hard-deletes a branch today (soft-delete via
-- is_active only, per docs/database.md), so this only tightens future
-- behavior and cannot break anything currently running.
ALTER TABLE public.stock_movements
  DROP CONSTRAINT stock_movements_store_id_branch_id_fkey,
  ADD CONSTRAINT stock_movements_store_id_branch_id_fkey
    FOREIGN KEY (store_id, branch_id) REFERENCES public.branches (store_id, id) ON DELETE RESTRICT;

ALTER TABLE public.cash_movements
  DROP CONSTRAINT cash_movements_store_id_branch_id_fkey,
  ADD CONSTRAINT cash_movements_store_id_branch_id_fkey
    FOREIGN KEY (store_id, branch_id) REFERENCES public.branches (store_id, id) ON DELETE RESTRICT;

-- 21.3 ROLLBACK (do not run automatically):
-- REVOKE EXECUTE ON FUNCTION public.delete_employee_user(uuid) FROM authenticated;
-- GRANT  EXECUTE ON FUNCTION public.delete_employee_user(uuid) TO PUBLIC;
-- REVOKE EXECUTE ON FUNCTION public.update_employee_user(uuid, text, text, uuid, text) FROM authenticated;
-- GRANT  EXECUTE ON FUNCTION public.update_employee_user(uuid, text, text, uuid, text) TO PUBLIC;
-- REVOKE EXECUTE ON FUNCTION public.preload_employee(text, text, text, uuid, uuid) FROM authenticated;
-- GRANT  EXECUTE ON FUNCTION public.preload_employee(text, text, text, uuid, uuid) TO PUBLIC;
-- ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_store_id_branch_id_fkey,
--   ADD CONSTRAINT stock_movements_store_id_branch_id_fkey FOREIGN KEY (store_id, branch_id) REFERENCES public.branches (store_id, id) ON DELETE CASCADE;
-- ALTER TABLE public.cash_movements DROP CONSTRAINT cash_movements_store_id_branch_id_fkey,
--   ADD CONSTRAINT cash_movements_store_id_branch_id_fkey FOREIGN KEY (store_id, branch_id) REFERENCES public.branches (store_id, id) ON DELETE CASCADE;

-- 22. sales — optional whole-sale discount (POS feature request)
-- Purely additive, nullable columns. discount_amount is the actual currency
-- amount subtracted from the pre-discount subtotal to reach total_amount;
-- discount_type/discount_value record HOW it was computed (for the receipt
-- and any future reporting), not just the result. sale_items are NEVER
-- touched by a discount - they keep full per-line prices; only
-- sales.total_amount (and, for split/combined payments, the sum of that
-- ref-code group's total_amount rows) reflects the discounted total.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS discount_type   text CHECK (discount_type IN ('percent', 'fixed')),
  ADD COLUMN IF NOT EXISTS discount_value  numeric(10,2),
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);

-- Rollback (do not run automatically):
-- ALTER TABLE public.sales DROP COLUMN IF EXISTS discount_amount, DROP COLUMN IF EXISTS discount_value, DROP COLUMN IF EXISTS discount_type;


