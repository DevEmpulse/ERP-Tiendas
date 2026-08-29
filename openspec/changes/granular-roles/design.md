# Design: Granular Roles (admin | encargado | caja | stock)

## Technical Approach

One appended `migration.sql` **section 16** carries the whole data-layer change, ordered
so a partial apply never locks out a live session (role CHECK widened first, generalized
branch CHECK last, mirroring 14.9). Above it, a single new TypeScript module
`src/lib/roles.ts` becomes the one place role sets are declared, and every gate
(`proxy.ts`, three page components, the sidebar, `UserManager`) imports from it — that is
the concrete mitigation for the proposal's "two gates drift apart" risk.

All line citations below were re-verified against the live 1077-line `migration.sql`; the
exploration's numbers had **not** drifted.

### Live-schema facts that shaped the design

| Fact | Where | Consequence |
|---|---|---|
| `clients` and `sales` each carry **two** policies — a store-wide `FOR SELECT` *and* a `FOR ALL` | `:86-95`, `:98-107` | Shape D must DROP **both** on `sales`, or the permissive-OR `FOR SELECT` re-opens store-wide reads. The proposal's rollback text says "single `FOR ALL`" — that is wrong for these two tables. |
| The `profiles` write policy's `id = auth.uid()` disjunct is in **both** `USING` and `WITH CHECK` | `:79-83` | **Any employee can already self-promote to `admin` today** by a direct `profiles` update. Not just latent for encargado — live. |
| The app never writes `profiles` from the client (only `SELECT` + the three RPCs) | grep `from('profiles')` | The self-write disjunct can simply be **dropped**, which is the cleanest fix. |
| `sale_items` has its own `branch_id` (`:894`), filled by `BEFORE INSERT` trigger `set_sale_item_branch` (`:913-916`) | 15.7 | Branch scoping on `sale_items` needs no join. RLS `WITH CHECK` runs **after** BEFORE-ROW triggers, so the trigger-filled value is the one checked. |
| `sale_items` has **no** `employee_id`; it lives on `sales` (`:32`) | 2 | Ownership on `sale_items` requires an `EXISTS` join back to `sales`. |
| `apply_sale_item_stock` / `adjust_branch_stock` are `SECURITY INVOKER` (`:921`, `:990`) | 15.8/15.9 | Their `branch_stock`/`stock_movements` writes are RLS-checked as the caller. Shape B (`:851-890`) already admits any branch-scoped role, so caja POS inserts and caja voids keep working unchanged. |
| `sales-form.tsx:265-268` and `SaleModal.tsx:335` `UPDATE clients SET name` | UI | Under Shape C a caja loses `clients.UPDATE`; supabase-js returns success with 0 rows, so this becomes a **silent no-op**. Must be role-guarded in code, not left lying. |
| `SaleModal` edit = delete-then-recreate with `employee_id = employeeId` (`:348-353`, `:390-434`) | UI | Reusable verbatim for caja correction: pass a one-element `employees` array so the selector degenerates to the caja themselves. |

---

## Architecture Decisions

### Decision: privilege-escalation fix uses a `CASE` on caller role over the **new row's** `role`

**Choice** — `WITH CHECK` is a `CASE public.get_current_user_role()` that maps each caller
role to the set of `role` values the written row may hold, plus an `AND branch_id =
get_current_user_branch_id()` arm for `encargado`. `USING` independently restricts which
**old** rows each caller may reach. The `id = auth.uid()` self-write disjunct is removed.

**Alternatives considered** — (a) keep self-write and forbid role drift via a `BEFORE
UPDATE` trigger comparing `OLD.role`/`NEW.role`; (b) `WITH CHECK (role =
get_current_user_role())` on the self path.

**Rationale** — (a) adds a trigger for a capability nothing in the app uses. (b) depends on
whether a VOLATILE `SECURITY DEFINER` helper sees the current command's own uncommitted
update — a snapshot-visibility subtlety we should not bet an escalation guard on. Dropping
self-write is provably safe here because the client never writes `profiles`, and both
`handle_new_user()` and the three RPCs are `SECURITY DEFINER` and bypass RLS entirely.

### Decision: `sale_items` gets its **own** ownership predicate on UPDATE/DELETE

**Choice** — the `sale_items` write predicate carries
`EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id AND s.employee_id = (select auth.uid()))`
for the caja/employee arm.

**Alternatives considered** — rely solely on the parent `sales` DELETE policy.

**Rationale** — two distinct paths, only one of which the parent policy covers:
- **Cascade path (covered by the parent alone).** `sale_items.sale_id` is `ON DELETE
  CASCADE` (`:479`). Postgres runs referential actions as the referenced table's owner with
  RLS bypassed, so the child rows are **not** RLS-filtered. That is safe *by construction*:
  if the caja cannot delete the parent `sales` row, the cascade never fires; if they can,
  they own the sale and deleting its lines is exactly right. No child predicate needed here.
- **Direct path (NOT covered).** `DELETE FROM sale_items WHERE sale_id = <a coworker's
  sale at my branch>` is an ordinary statement checked against `sale_items`' own policy.
  With branch-only scoping a caja could gut a coworker's sale and reverse its stock via
  `on_sale_item_deleted`. This violates the success criterion "cannot touch a sale created
  by a different employee, even at their own branch."

So: the explicit check is required, but **not** because of cascades — state both halves in
the spec so the reasoning is not re-litigated later.

### Decision: extract `StockAdjustDialog`, do not import `StockView` under `/employee`

**Choice** — pull the adjustment dialog out of `StockView.tsx` (state at `:146-151`,
handler at `:400-440`, JSX at `:864+`) into a new
`src/components/stock/StockAdjustDialog.tsx`; `StockView` and the new
`StockAdjustmentView` both import it.

**Alternatives considered** — (a) render `StockView` under `/employee` with feature flags;
(b) copy the dialog into a second component.

**Rationale** — `StockView` is 1377 lines of admin-scoped surface (product CRUD, price
rules, import/export, label queue). Every one of those writes is RLS-denied for `stock`
under Shape C, so (a) ships a screen of buttons that silently fail. (b) guarantees drift on
the next `adjust_branch_stock` signature change. The dialog is the only genuinely shared
unit; extracting it shrinks `StockView` and gives the new view a ~120-line body.

### Decision: role lists are literal SQL text, repeated, not a helper function

**Choice** — inline `IN ('encargado','caja','stock','employee')` at each of its three sites
(the CHECK constraint, `preload_employee`, `update_employee_user`), each with a comment
naming the others.

**Alternatives considered** — an `IMMUTABLE` `role_requires_branch(text)` helper used by
the CHECK too.

**Rationale** — a CHECK constraint depending on a user function is a known dump/restore
ordering hazard and complicates the "constraint last / constraint first on rollback"
pattern this file relies on. Section 15 already accepts literal duplication for Shape B.

### Decision: parameterize `AdminSidebar`, do not fork `EncargadoSidebar`

**Choice** — move `menuItems` to `src/components/admin/sidebar-items.ts` exporting
`ADMIN_MENU_ITEMS` and `ENCARGADO_MENU_ITEMS` (the admin list minus `branches` and
`settings`); `AdminSidebar` gains `items?: SidebarItem[]` (default: admin) and
`portalLabel?: string` (default `'Admin Portal'`). `EncargadoSidebar` is a 6-line wrapper.

**Rationale** — the component is 203 lines of pure presentation; a fork drifts on every
style change. Menu membership stays enumerable from one exported constant, which is the
whole point of Approach 2.

### Decision: keep bare `get_current_user_role()` calls in new policies

**Choice** — new policies use `public.get_current_user_role()` / `get_current_user_branch_id()`
inline, exactly as Shape B does, and use `(select auth.uid())` only where `auth.uid()` is
newly introduced.

**Alternatives considered** — wrap every helper as `(select public.get_current_user_role())`
to force an InitPlan (Supabase `auth_rls_initplan` guidance).

**Rationale** — textual symmetry with Shape B keeps the section reviewable and the rollback
mechanical. The lint is a pre-existing, repo-wide performance note on 0-row tables, not a
security finding. Recorded as an explicit follow-up, not silently ignored.

---

## Forward SQL — section 16 (ordered)

### 16.1 Role ladder (FIRST — nothing else may reference the new values before this)

```sql
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin','encargado','caja','stock','employee','superadmin'));
```

### 16.2 Employee RPCs — assignment matrix

`preload_employee` keeps its 5-arg signature, so `CREATE OR REPLACE` preserves grants.

```sql
CREATE OR REPLACE FUNCTION public.preload_employee(
  p_email text, p_name text, p_role text, p_store_id uuid, p_branch_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_dummy_id     uuid;
  v_caller_role  text;
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
```

`update_employee_user` gains `p_role` → **signature change**, so DROP + CREATE (mirrors
14.7). `p_role IS NULL` means "keep current role", preserving any un-migrated caller.

```sql
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
```

`delete_employee_user` keeps its signature; only the caller check at `:331-336` changes:

```sql
-- replaces the `role = 'admin'` EXISTS block at migration.sql:331-336
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
```
(`v_target_role`/`v_target_branch` join the existing `SELECT store_id INTO v_store_id` at
`:326-328`; the self-delete guard at `:339-341` and the `sales` detach at `:344-346` are
unchanged.)

### 16.3 `adjust_branch_stock` — minimal widening

`CREATE OR REPLACE` (same signature ⇒ the 15.10 `GRANT EXECUTE` survives). Only the block
at `:994-996` changes; everything from `p_delta = 0` onward is byte-identical.

```sql
  IF public.get_current_user_role()
     NOT IN ('admin','superadmin','encargado','stock') THEN
    RAISE EXCEPTION 'Only admins, encargados and stock staff can adjust stock';
  END IF;

  -- Branch ownership, mirroring the p_branch_id/store coherence check already below.
  IF public.get_current_user_role() NOT IN ('admin','superadmin')
     AND p_branch_id IS DISTINCT FROM public.get_current_user_branch_id() THEN
    RAISE EXCEPTION 'Cannot adjust stock for another branch';
  END IF;
```

`caja`/`employee` stay excluded: the POS decrements stock through
`apply_sale_item_stock`, never through a manual adjustment.

### 16.4 Shape C — store-wide read, role-gated write

`categories`, `products`, `product_price_rules`: drop the `FOR ALL` (`:498`, `:504`,
`:434`), add a read policy plus a write policy. `clients` already **has** the read policy
(`:86-89`, kept verbatim) so only its `FOR ALL` (`:91-95`) is dropped.

```sql
-- pattern, applied identically to categories / products / product_price_rules
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
```

```sql
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
```

### 16.5 Shape D — branch-scoped, verb-split

**Both** existing `sales` policies are dropped (`:98-101` SELECT and `:103-107` FOR ALL).

```sql
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

-- Own-rows predicate, used verbatim three times below.
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
```

`stock` appears in no write verb ⇒ RLS default-denies INSERT/UPDATE/DELETE.
The `WITH CHECK` on UPDATE also blocks a caja re-attributing a sale to someone else or
moving it to another branch.

`sale_items` mirrors it; ownership comes from the parent because `employee_id` is not on
this table. Branch comes from the row's own `branch_id`, filled by the BEFORE INSERT
trigger before `WITH CHECK` runs.

```sql
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

-- UPDATE and DELETE both use this predicate (DELETE has USING only).
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
```

The `EXISTS` subquery reads `sales` under the caller's own RLS (read is own-branch, so it
resolves) and hits `sales_pkey`. No recursion: `sales` policies never reference `sale_items`.

`branch_stock` and `stock_movements` are **unchanged** — Shape B (`:851-890`) already falls
through to `branch_id = get_current_user_branch_id()` for every branch-scoped role.

### 16.6 `profiles` privilege-escalation fix

Must land in **one statement pair** with the widening — never widen first, constrain later.
The read policy at `:74-77` is untouched.

```sql
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
```

Notes carried into the spec:
- The `id = auth.uid()` self-write disjunct from `:79-83` is **removed**; it was the live
  self-promotion hole. Self-read is still granted by the untouched policy at `:74-77`.
- `'superadmin'` is absent from the admin arm ⇒ an admin cannot mint a superadmin. The
  superadmin policy (`:405-409`) is separate and permissive-OR'd, so superadmins are
  unaffected.
- The `WITH CHECK` lists are **tolerance** lists (what a written row may hold, including
  legacy `employee` so an existing row can be renamed without a forced role change); the
  RPC lists in 16.2 are the narrower **assignable** lists. Do not conflate them.
- With the 16.7 invariant, admin/superadmin rows have `branch_id IS NULL`, so an
  encargado's `branch_id = …` arm can never match them.

### 16.7 Generalized branch CHECK — **LAST**

```sql
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_employee_branch_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_employee_branch_check
  CHECK (
    CASE
      WHEN role IN ('encargado','caja','stock','employee') THEN branch_id IS NOT NULL
      WHEN role IN ('admin','superadmin')                  THEN branch_id IS NULL
      ELSE true
    END
  );
```

The `admin/superadmin ⇒ NULL` half is **new** enforcement (nothing prevents it today; the
app merely never sets one). It is load-bearing for the encargado predicates above.

### 16.8 Rollback (bottom-to-top, never auto-run)

```
-- profiles_employee_branch_check -> CHECK (role <> 'employee' OR branch_id IS NOT NULL)
-- profiles policy               -> restore migration.sql:79-83 verbatim
-- sale_items                    -> drop the 4 verb policies; restore :509-513
-- sales                         -> drop the 4 verb policies; restore BOTH :98-101 and :103-107
-- clients                       -> drop both write policies; restore :91-95 (read :86-89 never changed)
-- product_price_rules           -> drop read+write; restore :433-437
-- products / categories         -> drop read+write; restore :503-507 / :497-501
-- adjust_branch_stock           -> CREATE OR REPLACE with the :994-996 check
-- delete_employee_user          -> restore the :331-336 caller block
-- update_employee_user          -> DROP the 5-arg form; restore the 4-arg :629-666 verbatim
-- preload_employee              -> CREATE OR REPLACE with the :592-604 body
-- profiles_role_check           -> narrow to ('admin','employee','superadmin') LAST, and
--                                  FAIL LOUDLY if any profile still holds a new role:
--    DO $$ BEGIN
--      IF EXISTS (SELECT 1 FROM public.profiles
--                  WHERE role IN ('encargado','caja','stock')) THEN
--        RAISE EXCEPTION 'Reassign encargado/caja/stock profiles before rolling back';
--      END IF;
--    END $$;
```

Revert the UI commits **together** with the SQL: a rolled-back schema plus a live
`/encargado` route is a route nobody can pass.

---

## Data Flow

```
proxy.ts ──role──> homeFor(role)
   ├─ admin      → /admin      (AdminSidebar,      branch <Select>, store-wide RLS)
   ├─ encargado  → /encargado  (EncargadoSidebar,  branchId = own profile.branch_id)
   ├─ caja/employee → /employee → EmployeeDashboard → SalesForm | MySalesView → SaleModal
   ├─ stock      → /employee → EmployeeDashboard → StockAdjustmentView → StockAdjustDialog
   └─ superadmin → /superadmin (unchanged)

caja voids own sale:
  MySalesView ──DELETE sales(ids)──> RLS sales DELETE (employee_id = auth.uid())
        │                                   │ allowed
        │                                   ▼
        │                        FK CASCADE deletes sale_items  (RLS bypassed by design)
        │                                   ▼
        └──────────────── on_sale_item_deleted (SECURITY INVOKER)
                                            ▼
                          branch_stock UPDATE + stock_movements INSERT
                          checked against Shape B → caja passes at own branch
```

---

## File Changes

| File | Action | Description |
|---|---|---|
| `migration.sql` | Modify | Append section 16 (16.1–16.8 above) |
| `src/lib/roles.ts` | Create | `Role` union, `BRANCH_SCOPED_ROLES`, `POS_ROLES` (`caja`+`employee`), `STOCK_ROLES`, `CATALOG_WRITE_ROLES`, `ADMIN_ASSIGNABLE_ROLES`, `ENCARGADO_ASSIGNABLE_ROLES`, `homeFor(role)`, `canAccess(prefix, role)`. Pure constants — safe in middleware. |
| `src/proxy.ts` | Modify | `isProtectedRoute` += `/encargado`; steps 4+5 collapse to `homeFor(role)`; new `/encargado` gate (`role !== 'encargado'`); `/employee` gate accepts `admin`+`POS_ROLES`+`STOCK_ROLES` |
| `src/app/encargado/page.tsx` | Create | Shell modelled on `admin/page.tsx` minus branch selector/localStorage: gate on `encargado`, read own `branch_id`, fetch that one branch's name, `.eq('branch_id', branchId)` on the sales query, `renderActiveView` over 6 sections |
| `src/app/admin/page.tsx` | Modify | `Profile.role: Role`; `:113` gate redirects via `homeFor` instead of `/login`; `profiles` select adds `branch_id` |
| `src/app/employee/page.tsx` | Modify | `:50` gate → `admin` ∪ `POS_ROLES` ∪ `STOCK_ROLES`; others `homeFor` |
| `src/components/admin/sidebar-items.ts` | Create | `SidebarItem`, `ADMIN_MENU_ITEMS`, `ENCARGADO_MENU_ITEMS` (admin minus `branches`, `settings`) |
| `src/components/admin/AdminSidebar.tsx` | Modify | `menuItems` moves out; new `items?` and `portalLabel?` props |
| `src/components/encargado/EncargadoSidebar.tsx` | Create | Wrapper: `<AdminSidebar items={ENCARGADO_MENU_ITEMS} portalLabel="Portal Encargado" …/>` |
| `src/components/stock/StockAdjustDialog.tsx` | Create | Extracted from `StockView.tsx` (`:146-151`, `:400-440`, `:864+`): the `adjust_branch_stock` call + its form |
| `src/components/admin/StockView.tsx` | Modify | Import the extracted dialog; delete the inlined copy (≈ −80 lines) |
| `src/components/employee/StockAdjustmentView.tsx` | Create | Own-branch product+`branch_stock` read, search, `StockAdjustDialog`, recent movements. **No** product CRUD, price rules, import/export, labels |
| `src/components/employee/MySalesView.tsx` | Create | Same-day (`created_at >= today's local midnight`) list of `sales` where `employee_id = me` at my branch, grouped with `groupSales`; edit → `SaleModal`; void → confirm + `deleteSaleGroup` |
| `src/components/employee/employee-dashboard.tsx` | Modify | Dispatch: `STOCK_ROLES` → `StockAdjustmentView`; otherwise a two-tab shell (`Nueva venta` = `SalesForm`, `Mis ventas` = `MySalesView`) |
| `src/components/employee/sales-form.tsx` | Modify | Guard the `clients.update({name})` at `:265-268` behind `CATALOG_WRITE_ROLES` — otherwise it is a silent no-op for caja |
| `src/components/admin/SaleModal.tsx` | Modify | Same client-rename guard at `:335`; accept `callerRole` |
| `src/lib/salesHelper.ts` | Modify | Extract `deleteSaleGroup(supabase, ids)` from `SaleModal.tsx:348-353`, reused by `MySalesView` |
| `src/components/admin/UserManager.tsx` | Modify | Role `<Select>` on invite (replacing `p_role: 'employee'` at `:274`) and on edit (`p_role` added to the RPC at `:177-182`); options from `ADMIN_ASSIGNABLE_ROLES`/`ENCARGADO_ASSIGNABLE_ROLES` by `callerRole`; branch select shown for `BRANCH_SCOPED_ROLES` (replacing `role === 'employee'` at `:162`, `:514`, `:596`); role badges for six values |
| `src/components/admin/StaffManagementView.tsx` | Modify | Pass `callerRole`/`callerBranchId` through to `UserManager` |
| `docs/authentication-and-roles.md`, `docs/database.md` | Modify | Role matrix, Shape C/D predicates, the escalation fix |

---

## Interfaces / Contracts

```ts
// src/lib/roles.ts — the single source of truth every gate imports
export type Role = 'admin' | 'encargado' | 'caja' | 'stock' | 'employee' | 'superadmin'

export const POS_ROLES            = ['caja', 'employee'] as const // legacy pairing
export const STOCK_ROLES          = ['stock'] as const
export const BRANCH_SCOPED_ROLES  = ['encargado', 'caja', 'stock', 'employee'] as const
export const CATALOG_WRITE_ROLES  = ['admin', 'superadmin', 'encargado'] as const
export const ADMIN_ASSIGNABLE_ROLES     = ['admin', 'encargado', 'caja', 'stock'] as const
export const ENCARGADO_ASSIGNABLE_ROLES = ['caja', 'stock'] as const

export function homeFor(role: string | null): string {
  if (role === 'superadmin') return '/superadmin'
  if (role === 'admin')      return '/admin'
  if (role === 'encargado')  return '/encargado'
  return '/employee'
}
```

```ts
// src/components/stock/StockAdjustDialog.tsx
export interface StockAdjustDialogProps {
  product: { id: string; name: string } | null   // null closes the dialog
  onOpenChange: (open: boolean) => void
  branchId: string | null
  branchName?: string
  currentStock?: number
  onAdjusted: (newBalance: number) => void
}
```

`MySalesView` reuses `SaleModal` unchanged apart from the rename guard, passing
`employees={[{ id: profile.id, name: profile.name }]}` and `branchId={profile.branch_id}` —
the single-element list makes its employee selector degenerate to exactly the row the RLS
`employee_id = auth.uid()` predicate permits, and its delete-then-recreate path
(`:348-353` → `:390-434`) satisfies the DELETE `USING` and the INSERT `WITH CHECK` in one
flow with no new write code.

---

## Testing Strategy

No automated suite exists (`openspec/config.yaml`: `test_command: ""`), so verification is
a scripted probe matrix on the Supabase **dev branch**, run via `execute_sql`.

| Layer | What to test | Approach |
|---|---|---|
| RLS matrix | 6 roles × {clients, categories, products, product_price_rules, sales, sale_items} × {SELECT, INSERT, UPDATE, DELETE} | Per role: `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '{"sub":"<profile-uuid>","role":"authenticated"}';` then assert affected-row counts / policy violations |
| RLS negative | encargado `UPDATE profiles SET role='admin'` (self and other); caja writing `products`; caja `UPDATE`/`DELETE` on a **coworker's** `sales` **and** a direct `DELETE FROM sale_items` targeting that coworker's `sale_id`; `stock` inserting `sales` | Each must return 0 rows or `new row violates row-level security policy` |
| Constraints | `encargado`/`caja`/`stock` with NULL `branch_id` rejected; `admin` with non-NULL `branch_id` rejected; all six values accepted | Direct INSERT/UPDATE as `postgres` |
| RPCs | admin invites all 4; encargado invites only caja/stock and only at own branch; caja/stock invite nothing; self-role-change rejected | `SELECT preload_employee(...)` per impersonated caller |
| Trigger integrity | a caja sale decrements `branch_stock` exactly once; voiding it writes one `sale_reversal` and restores the balance; an admin edit via `SaleModal` still nets to zero | Compare `branch_stock.current_stock` and `stock_movements` before/after |
| `adjust_branch_stock` | `stock` and `encargado` succeed at own branch, fail at another; `caja` rejected; `admin` unchanged | RPC call per impersonated caller |
| Routing | each of the 6 roles against `/`, `/login`, `/admin`, `/encargado`, `/employee`, `/superadmin`, checking `proxy.ts` **and** the page's own re-check agree | Manual session walk; both gates read `src/lib/roles.ts` |
| Build / advisors | `npm run build`; `get_advisors(type: 'security')` | No new security findings |

---

## Threat Matrix

Applicable: this change modifies routing (`src/proxy.ts` prefix gating + redirect target).
No shell, subprocess, VCS/PR automation, or executable-file classification is involved.

| Boundary | Minimum adversarial cases | Applicability | Design response | Planned RED tests |
|---|---|---|---|---|
| Documentation-like paths | `requirements.txt`, executable Markdown, `README.sh` | N/A — no file classification or execution anywhere in this change | — | — |
| Git repository selection | `git -C`, relative/absolute paths | N/A — no VCS automation | — | — |
| Commit state | staged, `commit -a`, empty index | N/A — no VCS automation | — | — |
| Push state | tracking branch, first push, refspec | N/A — no VCS automation | — | — |
| PR commands | `--head`, env prefix, composed commands | N/A — no PR automation | — | — |
| **Route prefix matching** (project-specific) | `/encargadoX`, `/encargado/../admin`, `/Encargado` (case), `/admin%2Fx`, a role with `branch_id = NULL` reaching `/encargado` | **Applicable** | `startsWith` is prefix-only, so `/encargadoX` matches the gate and is denied for non-encargado — safe by default. Next.js normalizes `..` before middleware. Matching stays case-sensitive and lowercase, consistent with the three existing prefixes. An `encargado` with NULL `branch_id` is impossible after 16.7; the page still guards `branch_id == null` by redirecting to `/login` rather than rendering a store-wide view. | Manual session walk per role × path, asserting `proxy.ts` and the page re-check return the same verdict |

---

## Migration / Rollout

1. **Pre-apply probes (orchestrator, before any DDL — no Supabase MCP access from this phase):**
   - `SELECT role, count(*) FROM profiles GROUP BY role;` — expect 2 `admin`, 1 `employee`,
     1 `superadmin`.
   - `SELECT count(*) FROM profiles WHERE role IN ('admin','superadmin') AND branch_id IS NOT NULL;`
     — **must be 0**, else 16.7's new admin-NULL half fails. Remediation: `UPDATE profiles
     SET branch_id = NULL WHERE role IN ('admin','superadmin');` before applying.
   - `SELECT count(*) FROM profiles WHERE role = 'employee' AND branch_id IS NULL;` —
     **must be 0**; `store-branches`' backfill (`state.yaml: production_backfill_performed`,
     carried into `granular-roles/exploration.md:25-31`) already set it, so this is a
     re-confirmation, not a new backfill.
   - `SELECT count(*) FROM sales;` — expect 0. A non-zero count with NULL `branch_id` rows
     would be stranded (invisible to every non-admin) under Shape D; stop and re-scope.
2. Apply section 16 on the **dev branch**, run the probe matrix, run `get_advisors`.
3. Apply to production inside a snapshot window, then deploy the UI commits in the **same**
   release. Schema-before-UI is safe (the legacy `employee` account keeps working); UI-before-schema
   is not (`/encargado` would exist with no role able to hold it).
4. No data migration: no forced reassignment of the legacy `employee` row (proposal Scope A).

**Review-budget note** — the SQL alone is ≈ 300 authored lines and the UI ≈ 700+. This
exceeds the 400-line budget decisively; `sdd-tasks` must slice as the proposal forecasts:
(1) role model + RPCs + constraints, (2) RLS closure (Shape C/D + profiles fix),
(3) `/encargado` route tree, (4) `/employee` split + `MySalesView` + `UserManager`.
Slice 2 must not ship without slice 1 (new roles must be storable first), and slices 3–4
must not ship before slice 2 (or the new UI writes hit the old permissive policies).

---

## Open Questions

- [x] `MySalesView`'s recency window — **RESOLVED: same-day only**, matching how a
      register closes. `created_at >= today's local midnight` (store/branch-local day
      boundary — `sdd-tasks` should confirm which timezone reference to use, likely the
      browser's local time since there is no per-store timezone setting today).
- [ ] The `auth_rls_initplan` performance lint (bare helper calls per row) is deliberately
      left as-is for textual symmetry with Shape B. Worth a dedicated follow-up change that
      wraps every policy helper call across sections 5/11/13/14/15/16 at once.
