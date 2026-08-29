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

