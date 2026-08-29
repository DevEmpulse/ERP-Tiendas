# Design: Multi-Branch Support (store-branches)

## Technical Approach

Append **section 14** to root `migration.sql`, additive and dependency-ordered:
`branches` + RLS → `profiles.branch_id` → `get_current_user_branch_id()` →
`sales.branch_id` → replaced `preload_employee()` / `update_employee_user()` /
`handle_new_user()` → the employee CHECK constraint last. No existing policy is
rewritten; `sales` RLS stays store-wide (`proposal.md` "Approach").

On the client, the selected branch is lifted state in `src/app/admin/page.tsx`
threaded as a `branchId` prop exactly the way `storeId`/`storeName` already are.
The employee side needs no new state: `branch_id` joins the profile object already
fetched once in `src/app/employee/page.tsx:39` and drilled to `sales-form.tsx`.

Granular roles are out of scope: `profiles_role_check` (`migration.sql:215`) is
untouched, and `get_current_user_role()` keeps returning exactly
`'admin' | 'employee' | 'superadmin'` — verified at `migration.sql:50-57` and
`:215`. Every predicate below depends on that literal domain.

## Architecture Decisions

### Decision: `ON DELETE NO ACTION` (not `RESTRICT`) on `profiles.branch_id` and `sales.branch_id`

**Choice**: spell the referential action as the SQL default `NO ACTION`.
**Alternatives considered**: `ON DELETE RESTRICT` (as written in `proposal.md`);
`ON DELETE SET NULL`.
**Rationale**: `SET NULL` is rejected outright — an employee must never silently
lose their branch, and the CHECK constraint would reject the resulting row anyway.
`RESTRICT` implements the intended rule but is non-deferrable and checked *immediately*,
so it would break the existing `DELETE FROM public.stores` path: `branches.store_id`,
`profiles.store_id` and `sales.store_id` are all `ON DELETE CASCADE`, and a store
deletion would trip the immediate branch check before the cascade removed the
referencing rows. `NO ACTION` defers the check to end-of-statement, so the cascade
completes, while a bare `DELETE FROM public.branches WHERE id = …` on a referenced
branch still fails with a foreign-key violation — identical protection for the case
the proposal actually cares about. **Apply-time probe required** (see Migration).

### Decision: `branches` RLS mirrors `profiles` (read-all / admin-write), not `categories` (`FOR ALL`)

**Choice**: one `FOR SELECT` policy for every user in the store, plus one `FOR ALL`
policy gated on `get_current_user_role() IN ('admin','superadmin')`.
**Alternatives considered**: copying `categories`' single `FOR ALL TO authenticated`
policy (`migration.sql:498-501`), which the proposal called the mirror.
**Rationale**: employees must *read* branch names (their own branch is shown in the
UI and `sales.branch_id` resolution reads it), but branch lifecycle is an admin
action. The read/admin-write split is already an in-repo precedent —
`migration.sql:74-83` does exactly this for `profiles`. Copying `categories` would
let any employee rename or deactivate a branch. `branches` mirrors `categories` in
*column shape*, which is what the proposal's "mirrors `categories`" is about.

### Decision: the CHECK constraint is added last in section 14

**Choice**: `profiles_employee_branch_check` is the final statement of section 14,
after all three function replacements.
**Alternatives considered**: adding it immediately after the column, per the
proposal's prose ordering.
**Rationale**: between the CHECK and the replaced `preload_employee()`, the old
4-argument function inserts employee profiles with `branch_id IS NULL` and would
fail. Ordering the constraint last makes any partially-applied migration
non-breaking rather than silently breaking employee invites.

### Decision: old function signatures are `DROP`ped, not just `CREATE OR REPLACE`d

**Choice**: `DROP FUNCTION public.preload_employee(text,text,text,uuid);` and
`DROP FUNCTION public.update_employee_user(uuid,text,text);` before creating the
wider versions.
**Alternatives considered**: `CREATE OR REPLACE` with the extra parameter.
**Rationale**: in Postgres, argument count is part of the identity — a replace with
one extra parameter creates a second **overload**, not a replacement. PostgREST then
resolves `supabase.rpc(...)` by body keys, so a stale caller would silently keep
hitting the branch-unaware version and produce branchless employees. Dropping makes
the break loud and immediate, which is the stated mitigation for the highest-likelihood
risk in `proposal.md`.

### Decision: the admin's selected branch is pure client-side state

**Choice**: RLS ceiling for an admin stays store-wide; the selector only decides
what a query/write *targets*, never what the DB *permits*.
**Alternatives considered**: a server-held `current_branch_id` for admins plus a
"switch branch" RPC, with RLS narrowing admins to it.
**Rationale**: restated from `exploration.md` Fork 2. The server-enforced variant
actively defeats the requirement that an admin manages every branch from one
account — every cross-branch view (consolidated stock, store-wide reports) would
need a privilege-escalation path, and every branch switch a server round-trip.
Accepted cost: an admin-side UI bug can target the wrong branch, with no DB safety
net below the store boundary. Recorded as a risk, not mitigated in this change.

### Decision: the selector lives in the admin header, not `AdminSidebar`

**Choice**: render it in the header block of `src/app/admin/page.tsx` (next to the
store name, `:396-403`); `AdminSidebar` only gains a `'branches'` nav entry.
**Alternatives considered**: inside `AdminSidebar`'s store header.
**Rationale**: on mobile the sidebar is a hidden drawer (`AdminSidebar.tsx:180-194`);
a branch switch would cost two taps and be invisible otherwise. The header is
always visible on both breakpoints, and `AdminSidebar` is a presentational nav
component whose props are navigation/identity only — adding data state to it breaks
that shape.

### Decision: edits preserve the sale's original branch

**Choice**: `SaleModal` writes `saleToEdit?.branch_id ?? branchId`.
**Alternatives considered**: always write the currently-selected `branchId`.
**Rationale**: `SaleModal` edit mode is delete-then-reinsert (`SaleModal.tsx:343-349`
then `:407`/`:425`), so the two insert paths serve create *and* edit. Always using
the selected branch would silently migrate a Branch-B sale to Branch-A whenever an
admin edits it from the history table with a different branch selected. Cost is
`branch_id` added to `Sale`/`GroupedSale` in `src/lib/salesHelper.ts` and to the
`sales` select in `src/app/admin/page.tsx:125-145`.

## Section 14 DDL

```sql
-- 14. Branches (sucursales) — per-store physical locations

-- 14.1 branches table (column shape mirrors categories, migration.sql:447-455)
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
```

## Two-Tier RLS Contract (copy-pasteable template)

Two predicate shapes now coexist. **Rule for any new table**: if the rows describe
things a store *shares* across locations (catalog, clients, price rules), use
shape A. If they describe things that exist *at* a location (stock, cash register,
per-branch counters), use shape B.

```sql
-- Shape A — STORE-WIDE table (unchanged; categories, products, sale_items, sales, clients)
CREATE POLICY "Users can manage <thing> in their store" ON public.<table>
  FOR ALL TO authenticated
  USING      (store_id = public.get_current_user_store_id())
  WITH CHECK (store_id = public.get_current_user_store_id());

-- Shape B — BRANCH-SCOPED table (first consumers: branch_stock, stock_movements)
-- Requires: <table>.store_id uuid NOT NULL, <table>.branch_id uuid NOT NULL.
-- Admins/superadmins float across every branch of their store; employees are
-- hard-restricted to their own branch at the DB layer, not just in the UI.
CREATE POLICY "Users can manage <thing> in their branch" ON public.<table>
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
```

The `'admin' | 'employee' | 'superadmin'` domain is verified against
`get_current_user_role()` (`migration.sql:50-57`) and `profiles_role_check`
(`:215`); neither is modified by this change. For split-verb tables (Phase 2's
append-only `stock_movements` uses separate `FOR SELECT` / `FOR INSERT` policies),
paste the same boolean expression into `USING` and `WITH CHECK` respectively — the
predicate is verb-independent.

**Employee-with-NULL-branch is a closed hole**: `profiles_employee_branch_check`
guarantees `get_current_user_branch_id()` is non-NULL for every employee, so
`branch_id = NULL` can never evaluate to a permissive match. Admins short-circuit
on the role test before the branch comparison is reached.

## `sales.branch_id` Resolution — the 4 Writer Call Sites

### Employee path — `src/components/employee/sales-form.tsx` (`:348`, `:359`, `:370`, `:402`)

`branch_id` is **not** re-queried at insert time. It rides the profile object
already fetched once at `src/app/employee/page.tsx:39` and drilled down unchanged:

```
src/app/employee/page.tsx            select('id, store_id, name, role, email, branch_id, stores(...)')
  └─ Profile interface (:9-15)        + branch_id: string | null
      └─ employee-dashboard.tsx       Profile interface (:10-16)  + branch_id
          └─ sales-form.tsx           SalesFormProps.profile (:32-37) + branch_id
```

Inside `handleSubmit`, alongside the existing `const storeId = profile.store_id`
/ `const employeeId = profile.id` (`:237-238`):

```ts
const branchId = profile.branch_id   // non-null for employees (DB CHECK guarantees it)
```

then `branch_id: branchId,` is added to all four insert objects — the three
combined-payment rows pushed into `salesToInsert` and the single-payment object.

**Known gap (documented, not fixed here)**: `src/proxy.ts` also lets an `admin`
reach `/employee`, and `src/app/employee/page.tsx:49` accepts that role. An admin
using the employee POS has `branch_id IS NULL`, so that sale is written with a NULL
branch. The column is nullable, so nothing breaks. Guarding it would require a
branch selector on the employee surface, which is outside "minimal UI"; the
`granular-roles` change closes it.

### Admin path — `src/components/admin/SaleModal.tsx` (`:384`, `:392`, `:400`, `:418`)

`SaleModalProps` gains `branchId: string | null` (mirroring the existing
`storeId: string | null` at `:37`). Resolution inside `handleSubmit`:

```ts
const resolvedBranchId = saleToEdit?.branch_id ?? branchId
```

added to all four insert objects (three `salesToInsert.push(...)` calls plus
`saleData`). Threading, following the existing `storeId` path exactly:

```
src/app/admin/page.tsx  (selectedBranchId state)
  ├─ DashboardView  branchId ──┬─ SaleModal (create, DashboardView.tsx:110)
  │                            └─ SalesTable branchId ─ SaleModal (edit, SalesTable.tsx:429)
  └─ HistoryView    branchId ─── SalesHistory branchId ─ SalesTable ─ SaleModal (edit)
```

`SaleModal` is rendered from three places but has only two insert paths, because
edit mode is delete-then-reinsert (`:343-349`). `SalesTable` and `SalesHistory` gain
a pass-through `branchId?: string | null` prop with a `null` default, identical to
their current `storeId` handling.

## Admin Branch Selector

State lives in `src/app/admin/page.tsx` next to `storeInfo`/`paperWidth`:

```ts
const [branches, setBranches] = useState<Branch[]>([])          // active only
const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null)
const [refreshBranchesKey, setRefreshBranchesKey] = useState(0)  // mirrors refreshSalesKey (:53)
```

- **Load**: one `supabase.from('branches').select('id, name').eq('is_active', true)
  .order('name')` in the existing post-profile data `useEffect` (`:116-172`), keyed
  on `userProfile?.store_id` and `refreshBranchesKey`. RLS scopes it; no explicit
  `store_id` filter is needed, matching how `StockView.tsx:80-83` loads price rules.
- **Default / persistence**: read `localStorage['erp:selectedBranchId:' + storeId]`;
  if it is missing or no longer in the active list, fall back to the first active
  branch. Write it back on every change. There is no "All branches" option
  (`proposal.md` round-2 decision 2) — exactly one concrete active branch is always
  selected, so every admin-made sale carries a branch.
- **Across navigation**: `/admin` is a single client page with a `switch` over
  `activeSection` (`:271-326`), so lifted state already survives section changes;
  `localStorage` only covers a full page reload.
- **Control**: a `Select` (`src/components/ui/select.tsx`) in the header block
  (`:396-403`), beside the store name, with a `Store` icon — one `SelectTrigger` +
  one `SelectItem` per active branch. Hidden while `branches.length < 2` is *not*
  done: it stays visible so the admin can always see which branch is targeted.

Consumers receiving `branchId={selectedBranchId}`: `DashboardView`, `HistoryView`
(→ `SalesHistory` → `SalesTable`), and later `StockView` (Phase 2). `UserManager`
does **not** consume it — invite/edit pick a branch explicitly from their own select.

## `BranchManager.tsx` (new)

New file `src/components/admin/BranchManager.tsx`, reachable from a new
`'branches'` entry in the `AdminSection` union (`AdminSidebar.tsx:6`), a new
`menuItems` row (`Building2` icon, label "Sucursales", description "Crear, renombrar
y desactivar sucursales") and a new `case` in `renderActiveView` (`page.tsx:271`).

Structure copies `StockView.tsx` verbatim in shape: `Card` + `CardHeader` (title,
description, "Nueva sucursal" button) + `Table` (Sucursal · Estado · Creada ·
Acciones) + one `Dialog` for create/edit + one `Dialog` for deactivate
confirmation + `useToast`/`Toaster`, with the same optimistic-close-then-refetch
flow and the same duplicated `loadBranches` `useCallback` + initial `useEffect`
with an `ignore` guard.

```ts
interface BranchManagerProps {
  storeId: string | null
  onBranchesChange?: () => void   // bumps refreshBranchesKey in page.tsx
}
```

| Action | Implementation |
|--------|----------------|
| Create | `insert({ store_id: storeId, name })` — `name` is the only field (no address; `stores` has none either) |
| Rename | `update({ name, updated_at: new Date().toISOString() }).eq('id', id)` |
| Deactivate | `update({ is_active: false, updated_at: … }).eq('id', id)` — **never** `.delete()` |
| Reactivate | `update({ is_active: true, … })` — the table lists inactive branches too, greyed with an "Inactiva" badge |

Deactivation is non-destructive: employees already assigned keep their `branch_id`
and keep working; the branch simply disappears from the header selector and from
`UserManager`'s selects. Client-side guard: refuse to deactivate the last active
branch (the DB has no such constraint; this is a UI courtesy, and `handle_new_user()`
only guarantees a branch exists at signup). Every mutation calls `onBranchesChange()`
so the header selector refetches.

## `UserManager.tsx` Changes

| Where | Change |
|-------|--------|
| `UserProfile` interface (`:23-29`) | `+ branch_id: string \| null` |
| Both profile fetches (`:62`, `:81`) | select adds `branch_id` |
| New state | `branches: Branch[]` (active only), `newBranchId`, `editBranchId` |
| New effect | loads active branches once, alongside the existing `supabase.auth.getUser()` call (`:96`) |
| Invite dialog (`:316-366`) | new required `Select` "Sucursal", defaulted to the first active branch; blocks submit with `setErrorMsg('Selecciona una sucursal.')` when empty |
| `preload_employee` call (`:215-220`) | `+ p_branch_id: branchIdSnapshot` |
| Edit dialog (`:477-525`) | same `Select`, preselected from `selectedUser.branch_id`; shown only when `selectedUser.role === 'employee'` |
| `openEdit` (`:173-179`) | `+ setEditBranchId(user.branch_id)` |
| `update_employee_user` call (`:129-133`) | `+ p_branch_id: branchIdSnapshot` |
| Table (`:385-460`) | new "Sucursal" column: branch name for employees, `—` for admins |

Reassignment takes effect on the employee's next request, because
`get_current_user_branch_id()` reads `profiles` live on every policy evaluation.

## Data Flow

```
SIGNUP (new owner)
  auth.users INSERT ─ on_auth_user_created ─ handle_new_user()
       └─ INSERT stores ─→ INSERT branches ('Sucursal Principal')
                        └─ INSERT profiles (role='admin', branch_id=NULL)

INVITE EMPLOYEE
  UserManager ─ Select(active branches) ─ rpc preload_employee(…, p_branch_id)
       └─ validate role/caller/branch-belongs-to-store
           └─ INSERT auth.users(dummy) + profiles(role='employee', branch_id=X)
  first Google login ─ handle_new_user() relink path ─ branch_id preserved

SALE — employee                       SALE — admin
  employee/page.tsx (profile+branch)    admin/page.tsx (selectedBranchId)
    └─ SalesForm                          └─ DashboardView / HistoryView
        branch_id = profile.branch_id         └─ SaleModal
        └─ INSERT sales × 1|3                     branch_id = saleToEdit?.branch_id
                                                              ?? branchId
                                                  └─ INSERT sales × 1|3
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `migration.sql` | Modify | Section 14 (14.1–14.9) + rollback block |
| `src/components/admin/BranchManager.tsx` | Create | Branch create / rename / deactivate / reactivate |
| `src/app/admin/page.tsx` | Modify | `branches` + `selectedBranchId` + `refreshBranchesKey` state, header `Select`, `branch_id` in the sales select, `'branches'` case, `branchId` prop to Dashboard/History |
| `src/components/admin/AdminSidebar.tsx` | Modify | `'branches'` in `AdminSection` + one `menuItems` entry |
| `src/components/admin/UserManager.tsx` | Modify | Branch select on invite and edit, both RPC signatures, `branch_id` in fetch, "Sucursal" column |
| `src/components/admin/SaleModal.tsx` | Modify | `branchId` prop; `branch_id` on 4 insert objects |
| `src/components/admin/DashboardView.tsx` | Modify | `branchId` prop → `SaleModal` + `SalesTable` |
| `src/components/admin/HistoryView.tsx` | Modify | `branchId` pass-through → `SalesHistory` |
| `src/components/admin/SalesHistory.tsx` | Modify | `branchId` pass-through → `SalesTable` |
| `src/components/admin/SalesTable.tsx` | Modify | `branchId` pass-through → `SaleModal` |
| `src/lib/salesHelper.ts` | Modify | `branch_id?: string \| null` on `Sale` + `GroupedSale`, carried through `groupSales` |
| `src/components/employee/sales-form.tsx` | Modify | `profile.branch_id`; `branch_id` on 4 insert objects |
| `src/components/employee/employee-dashboard.tsx` | Modify | `Profile.branch_id` pass-through |
| `src/app/employee/page.tsx` | Modify | `branch_id` in the profile select + interface |
| `docs/database.md` | Modify | `branches` entry, `profiles.branch_id`, `sales.branch_id`, both RLS shapes + the "which shape" rule |
| `docs/authentication-and-roles.md` | Modify | Role/branch matrix, `get_current_user_branch_id()` |
| `src/proxy.ts` | Unchanged | Branch is data scoping inside existing routes |

## Interfaces / Contracts

```ts
// New — used by BranchManager, UserManager and src/app/admin/page.tsx
interface Branch {
  id: string
  name: string
  is_active: boolean
  created_at: string
}
```

| RPC | Old signature | New signature |
|-----|---------------|---------------|
| `preload_employee` | `(text, text, text, uuid)` | `(text, text, text, uuid, uuid)` — `p_branch_id` required for `p_role='employee'` |
| `update_employee_user` | `(uuid, text, text)` | `(uuid, text, text, uuid)` — `p_branch_id` required when the target is an employee |
| `get_current_user_branch_id` | — | `() → uuid` (NULL for admin/superadmin) |

## Testing Strategy

No automated test infrastructure exists in this repo (no test runner, no test
files). Verification is manual + SQL probes, matching Phase 1/2.

| Layer | What to Test | Approach |
|-------|--------------|----------|
| Schema | CHECK rejects employee without branch; accepts admin with NULL | `execute_sql` INSERT probes on a Supabase development branch |
| Schema | Hard-deleting a referenced branch fails; `DELETE FROM stores` still cascades cleanly | Two `execute_sql` probes — this is the `NO ACTION` decision's acceptance test |
| RLS | Cross-tenant `SELECT branches` returns zero rows | Signed-in probe as a second store's admin |
| RLS | Employee cannot INSERT/UPDATE/DELETE `branches`; can SELECT them | Signed-in probe as an employee |
| Function | `preload_employee` rejects NULL branch for employee and a foreign-store branch | `execute_sql` with expected `RAISE EXCEPTION` |
| Function | `get_current_user_branch_id()` returns the employee's branch, NULL for admin | `execute_sql` as each role |
| Integration | Invite → branch assigned; reassign → new branch reflected | Manual through `UserManager` |
| Integration | Signup creates "Sucursal Principal" | Whitelist a test email, sign in, assert one branch row |
| E2E | 4 writer paths produce non-null `branch_id` | One employee sale + one admin single + one admin split + one admin edit; then `SELECT id, branch_id FROM sales ORDER BY created_at DESC LIMIT 8` |
| Regression | Employees still see all store sales; catalog reads unchanged | Manual as employee |
| Build | `npm run build`; `get_advisors` reports no new findings | CLI/MCP |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file
classification, or process-integration boundary. `src/proxy.ts` is reviewed and
unchanged; branch scoping is data access inside existing authorized routes.

## Migration / Rollout

Zero production rows confirmed (`state.yaml` `decisions.production_data`), so **no
backfill**. Apply 14.1 → 14.9 in order on the Supabase development branch first,
run the schema/RLS/function probes above, then `get_advisors`, then promote.

SQL and UI must ship in the same window: after 14.6/14.7 the old RPC signatures no
longer exist, so an un-updated `UserManager.tsx` breaks invites and edits
immediately — that loudness is the intended mitigation (see the DROP decision).

**Immediately after apply, run the `NO ACTION` acceptance probe** before writing any
data: create a throwaway store + branch + employee, assert `DELETE FROM
public.branches WHERE id = …` fails, assert `DELETE FROM public.stores WHERE id = …`
succeeds. If the store delete fails, the referential action needs revisiting before
the change lands.

### Rollback SQL

```sql
-- ROLLBACK (do not run automatically) — reverse of section 14, bottom to top:
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_employee_branch_check;
-- Restore the pre-branch handle_new_user() body verbatim from migration.sql:246-311.
DROP FUNCTION IF EXISTS public.update_employee_user(uuid, text, text, uuid);
-- Restore the 3-arg update_employee_user() verbatim from migration.sql:355-392.
DROP FUNCTION IF EXISTS public.preload_employee(text, text, text, uuid, uuid);
-- Restore the 4-arg preload_employee() verbatim from migration.sql:163-210.
DROP INDEX    IF EXISTS public.sales_branch_id_idx;
ALTER TABLE public.sales    DROP COLUMN IF EXISTS branch_id;
DROP FUNCTION IF EXISTS public.get_current_user_branch_id();
DROP INDEX    IF EXISTS public.profiles_branch_id_idx;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS branch_id;
DROP TABLE    IF EXISTS public.branches CASCADE;
```

Drop order is strict: the CHECK before the columns it guards, the widened functions
before the columns they write, both `branch_id` columns before `branches`. Revert
the UI commits together with the SQL — a rolled-back schema with branch-aware
writers breaks every sale insert (`proposal.md` Rollback Plan).

## Phase 2 Consumability Check

Verified against `openspec/changes/stock-phase2-quantities-movements/design.md`:
its section 14 becomes section 15; `stock_movements` gains `branch_id uuid NOT NULL
REFERENCES public.branches(id)` and swaps its `FOR SELECT`/`FOR INSERT` predicates
(`design.md:227-235`) for Shape B's boolean expression verbatim; `branch_stock` is
keyed `(branch_id, product_id)` under the same Shape B; `adjust_product_stock`'s
`get_current_user_role() <> 'admin'` guard (`:345`) still holds unchanged because
this change does not touch the role domain; and `apply_sale_item_stock()` can
resolve a branch because `sales.branch_id` now exists and is populated. Nothing in
Phase 2 is redesigned here.

## Open Questions

- [ ] None blocking. The single item requiring apply-time confirmation is the
      `NO ACTION` vs `RESTRICT` store-cascade behavior, with its probe defined above.
