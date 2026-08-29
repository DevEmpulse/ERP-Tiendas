```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:1eb213405aadfe01e85d48b5e058575e55196782b96f4765418565dc1d0a7160
verdict: pass
blockers: 0
critical_findings: 0
requirements: 11/11
scenarios: 19/19
test_command: ""
test_exit_code: 0
test_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
build_command: "npm run build"
build_exit_code: 0
build_output_hash: sha256:4feb006d24e02856ddca7f6e7969f1a88dadfa8a8a50ac3d02e3ebe7ad19ae36
```

## Verification Report

**Change**: stock-phase1-catalog
**Version**: N/A (no prior spec version — first `openspec/specs/` capabilities)
**Mode**: Standard (project config: `apply.tdd: false`, `verify.test_command: ""` — no automated test suite; manual/DB-probe verification is the documented convention, per `openspec/config.yaml`)
**Re-verification**: This report supersedes the prior `verify-report.md` (evidence at commit `5b949f9`), which found exactly ONE CRITICAL finding: `product-catalog#Price Rule Product Reference Migration`'s two scenarios required `product_id`-based lookups that the (correctly deferred, per `design.md`) implementation does not perform. The orchestrator has since amended `specs/product-catalog/spec.md` to descope the behavioral cutover to Phase 4 and replaced the two old scenarios with two new ones ("Price rules keep resolving by name in this phase", "`product_id` cutover deferred to Phase 4") matching actual behavior. No code changed. This is a full independent re-verification of ALL artifacts and ALL requirements, not a spot-check of only the amended requirement.

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total (Batches 1-6, excluding informational checkpoints) | 22 |
| Tasks complete | 22 |
| Tasks incomplete | 0 |
| Post-apply verification checkpoints (informational re-checks, not implementation tasks) | 7 (unchecked by design — re-confirmed below) |

All Batch 1-6 tasks remain marked `[x]` and were independently re-checked against current source/SQL in this pass (not taken on trust from the checkbox or the prior report). Batch 6 (merge to production) remains correctly marked N/A with an explicit, evidenced reason: `create_branch` requires a `confirm_cost_id` this MCP server never exposes, so no development branch could be provisioned; the user explicitly re-approved a direct-to-production apply in place of the proposal's original Q1 resolution. This is a real deviation from the proposal's resolved decision — flagged as WARNING below, unchanged from the prior report — but it is transparently logged, not silently substituted.

### Build & Tests Execution

**Build**: ✅ Passed (independently re-run in this verification pass)
```text
$ npm run build
▲ Next.js 16.2.6 (Turbopack)
✓ Compiled successfully in 1967ms
  Running TypeScript ... Finished TypeScript in 1818ms
✓ Generating static pages using 9 workers (10/10)
  Finalizing page optimization ...
Route (app): /, /_not-found, /admin, /auth/callback, /employee, /login, /manifest.webmanifest, /superadmin
```
Exit code: 0

**Lint** (independently re-run; referenced by task 5.2):
```text
$ npm run lint
(no output)
```
Exit code: 0

**Tests**: ➖ Not applicable — `openspec/config.yaml` declares `verify.test_command: ""` and no automated test suite is configured in this repository. Manual/DB-probe verification (Batch 3, `get_advisors`, cross-tenant SQL probes) is the documented substitute; this re-verification pass has no Supabase MCP access, so `get_advisors`/live RLS probes were not re-executed here. This is a scope limitation of this re-verification session, not new evidence of a regression — no code or schema changed since the prior pass's independently-recorded `get_advisors` clean result (tasks.md 3.1, 6.2), and `migration.sql` section 13 is byte-identical to the version previously verified.

**Coverage**: N/A — `coverage_threshold: 0`, no coverage tool configured.

### Spec Compliance Matrix

#### `product-catalog`

| Requirement | Scenario | Evidence | Result |
|-------------|----------|----------|--------|
| Category and Product Catalog Data Model | Admin creates a product without a category | `migration.sql:458-469` — `category_id` nullable, `is_active boolean NOT NULL DEFAULT true` | ✅ COMPLIANT |
| Category and Product Catalog Data Model | Admin creates a category | `migration.sql:447-454` — per-store `categories` table, `store_id NOT NULL` | ✅ COMPLIANT |
| Barcode Uniqueness Per Store | Duplicate barcode rejected within same store | `migration.sql:472-473` partial unique index `(store_id, barcode) WHERE barcode IS NOT NULL` | ✅ COMPLIANT |
| Barcode Uniqueness Per Store | Same barcode allowed across stores | Same partial index, scoped by `store_id` | ✅ COMPLIANT |
| RLS Isolation (Categories/Products) | Cross-tenant read returns zero rows | `migration.sql:497-507` RLS policies verbatim `clients`/`product_price_rules` pattern | ✅ COMPLIANT |
| RLS Isolation (Categories/Products) | Cross-tenant write rejected | Same policies' `WITH CHECK` clause | ✅ COMPLIANT |
| Soft-Delete History Preservation | Category deletion detaches its products | `migration.sql:461` `category_id ... ON DELETE SET NULL` | ✅ COMPLIANT |
| Soft-Delete History Preservation | Product soft-delete preserves prior sales | `is_active` column; `sale_items.product_id ON DELETE SET NULL` never cascades to `sale_items` | ✅ COMPLIANT |
| Price Rule Product Reference Migration | Price rules keep resolving by name in this phase | `sales-form.tsx:536` and `SaleModal.tsx:557` call `getMatchingRule(detail, quantity)` with **no** `productId` argument, so both always fall through to the `r.product_name.toLowerCase() === lower && r.quantity === qty` branch (`sales-form.tsx:122`, `SaleModal.tsx:282`) — name-based resolution, exactly as this scenario now requires | ✅ COMPLIANT |
| Price Rule Product Reference Migration | `product_id` cutover deferred to Phase 4 | `StockView.tsx` CRUD insert/update (lines 188/195) writes only `product_name`, never `product_id`; `sales-form.tsx`/`SaleModal.tsx` resolve `sale_items.product_id` via a lookup-only, best-effort name match that yields `null` on no match (`sales-form.tsx:333`, `SaleModal.tsx:370`) — no call site requires `product_id` to be set, matching the scenario's "MAY remain unset" language verbatim | ✅ COMPLIANT |
| Non-Regression and Build Verification | Build and advisors pass | `npm run build` exit 0 (re-verified this pass); `migration.sql` section 13 unchanged since the prior pass's independently-confirmed `get_advisors` clean result | ✅ COMPLIANT |
| Non-Regression and Build Verification | Catalog usable without Phase 2 | No code in this diff references stock-quantity tables/columns (`grep` across changed files confirms) | ✅ COMPLIANT |

#### `sale-line-items`

| Requirement | Scenario | Evidence | Result |
|-------------|----------|----------|--------|
| Structured Sale Line Items | Sale with a single payment method | `sales-form.tsx:399-420`, `SaleModal.tsx:417-431` — single-payment path inserts `sale_items` rows tied to the one inserted `sales.id` | ✅ COMPLIANT |
| Structured Sale Line Items | Split payment across two sales rows | `sales-form.tsx:340-396`, `SaleModal.tsx:377-416` — `buildSaleItemsForSale` called once per resulting `sales` row via `.flatMap` | ✅ COMPLIANT |
| RLS Isolation (Sale Items) | Cross-tenant read returns zero rows | `migration.sql:509-513` RLS policy on `sale_items` | ✅ COMPLIANT |
| Sale Line Item Survival on Product Deletion | Historical line item outlives its product | `migration.sql:480` `product_id ... ON DELETE SET NULL`; `unit_price`/`subtotal` plain stored columns, never recomputed | ✅ COMPLIANT |
| `sales.description` Compatibility During Transition | Legacy description still renders | `migration.sql:523` `ALTER COLUMN description DROP NOT NULL`; `parseSaleDescription` and `groupSales` (`salesHelper.ts:140,145`) are null-safe via `(sale.description ?? '')` | ✅ COMPLIANT |
| Existing Sales Display Compatibility | PDF receipt renders from `sale_items` | Full chain re-traced: `admin/page.tsx:137` and `EmployeeReport.tsx:77` select `sale_items(...)` → `groupSales` (`salesHelper.ts:181,214`) copies `sale_items` onto `GroupedSale` → `pdfGenerator.ts:164` calls `getSaleLines(sale)`, preferring `sale.sale_items` when present (`salesHelper.ts:89-96`) | ✅ COMPLIANT |
| Existing Sales Display Compatibility | Sale modal renders a legacy sale unchanged | `SaleModal.tsx` still edits/renders exclusively via `description`; no `sale_items` read path exists there, so a legacy sale renders unchanged | ✅ COMPLIANT |

**Compliance summary**: 19/19 scenarios compliant.

### Correctness (Static Evidence) — re-confirmed this pass

| Check | Status | Notes |
|-------|--------|-------|
| `SaleModal.tsx` edit-mode recreates `sale_items` after delete+re-insert | ✅ Confirmed | `handleSubmit` deletes old `sales` rows (`:343`) then, unconditionally, runs the same insert-then-`sale_items`-insert sequence used for new sales (combined `:407-416`, single `:425-431`); `sale_items` insert errors `throw` into the same `catch`. |
| `groupSales()` null-`description` safety | ✅ Confirmed | `salesHelper.ts:140` and `:145` both use `(sale.description ?? '')` before `.match`/`.replace`. |
| `pdfGenerator.ts` actually receives `sale_items` via `GroupedSale` | ✅ Confirmed | Full call chain re-traced from Supabase `select` through `groupSales` to `getSaleLines`. |
| `product_id` lookup is exact/case-insensitive against **active** products only, never fuzzy, never creates products | ✅ Confirmed | `sales-form.tsx:314-333`, `SaleModal.tsx:351-370` — both query `products` with `.eq('is_active', true)`, build a `Map` keyed by `name.trim().toLowerCase()`, exact match only, `?? null` on miss, no insert into `products` anywhere in either file. |
| `getMatchingRule` never receives a `productId` argument from any call site | ✅ Confirmed | `grep` across `sales-form.tsx`/`SaleModal.tsx` shows the only two call sites (`:536`, `:557`) pass exactly `(detail, quantity)` — the `productId`-first branch is unreachable, consistent with the spec's own "deferred to Phase 4" framing (no longer a contradiction, since the spec no longer requires this branch to be live). |
| `npm run build` / `npm run lint` independently pass | ✅ Confirmed | Re-run directly in this verification pass, exit 0 both. |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| `sale_items.sale_id ON DELETE CASCADE` | ✅ Yes | `migration.sql:479` |
| `sale_items.product_id` nullable, `ON DELETE SET NULL`, plus `product_name` snapshot | ✅ Yes | `migration.sql:480-481` |
| `subtotal` plain stored column, not generated | ✅ Yes | `migration.sql:483` — no `GENERATED ALWAYS AS` clause |
| Partial unique index on `(store_id, barcode) WHERE barcode IS NOT NULL` | ✅ Yes | `migration.sql:472-473` |
| Denormalized `store_id` on `sale_items` | ✅ Yes | `migration.sql:477`, policy identical to `clients`/`product_price_rules` pattern |
| `sales.description` kept nullable, not dropped | ✅ Yes | `migration.sql:523`; still written by every insert path in `sales-form.tsx`/`SaleModal.tsx` |
| Sections 1-12 of `migration.sql` untouched | ✅ Yes | `git diff HEAD~1 -- migration.sql` shows a pure append starting at line 444 |
| Section 13 SQL matches `design.md` forward SQL verbatim | ✅ Yes | Byte-for-byte match confirmed by direct comparison |
| Product picker deferred to Phase 4; lookup-only `product_id` resolution, no product auto-creation | ✅ Yes | Confirmed in both POS call sites |
| Price-rule name→id cutover deferred to Phase 4 | ✅ Yes (spec now matches) | `design.md`'s Open Questions flagged this deferral before apply; `specs/product-catalog/spec.md`'s `Price Rule Product Reference Migration` requirement has since been amended to state the deferral explicitly and its two scenarios now describe actual shipped behavior. Design, code, and spec are now mutually consistent — the previously-reported spec/design wording mismatch is resolved. |

### Issues Found

**CRITICAL**: None.

**WARNING**:
1. Batch 6 deviates from `proposal.md`'s explicitly resolved Q1 decision ("Provision a Supabase development branch first... No production apply before a branch exists"). The deviation (direct-to-production apply) is well-justified and documented in `tasks.md` 6.1 (the MCP `create_branch` tool requires a `confirm_cost_id` this server never exposes) and was re-approved by the user at apply time, but it remains a departure from a decision explicitly "RESOLVED" in the proposal. Unchanged from the prior verification pass. Recommend noting this precedent for future SDD changes on this project.
2. This re-verification session has no Supabase MCP access, so `get_advisors` and the live cross-tenant RLS probes (design.md's "RLS Verification Plan") were not re-executed independently here; this pass relies on the prior verification's already-independently-recorded clean result plus the fact that `migration.sql` section 13 is byte-identical to what was previously verified (confirmed via direct diff in this pass). Recommend a follow-up `get_advisors` run before `sdd-archive` if a maintainer has Supabase MCP access available, though this is not a blocker given the unchanged SQL.

**SUGGESTION**:
1. `GroupedSale.description` is typed as `string` (non-nullable) in `salesHelper.ts`, but `groupSales`'s `cleanDesc || sale.description` fallback can theoretically assign `null` at runtime if a future sale is inserted with a `null` `description` (now legal per this migration's `DROP NOT NULL`) and produces an empty `cleanDesc`. No current write path in `sales-form.tsx`/`SaleModal.tsx` actually inserts a `null` description, so this is latent, not an active bug — worth tightening in Phase 2+.

### Verdict

**PASS**

All 22 implementation tasks (Batches 1-6) are genuinely done, independently re-verified by direct SQL/source inspection in this pass, not by trusting the checkboxes or the prior report. The migration is a clean, verbatim-matching append to `migration.sql`; RLS, FK actions (`CASCADE`/`SET NULL`), soft-delete, and the partial barcode index all match `design.md` exactly. All correctness checks (edit-mode `sale_items` recreation, null-safe `groupSales`, `pdfGenerator` receiving structured items via `GroupedSale`, exact-match active-product-only lookup, and independently-run build/lint) check out cleanly. The previously-reported CRITICAL — `product-catalog#Price Rule Product Reference Migration`'s two scenarios requiring `product_id`-based resolution — is resolved: the orchestrator amended the requirement and its two scenarios to explicitly descope the behavioral cutover to Phase 4 and describe the actual, already-implemented name-based-resolution behavior. Both new scenarios are genuinely satisfied by the current code, confirmed by direct inspection of the only two call sites of `getMatchingRule` and of `StockView.tsx`'s CRUD paths. 19/19 scenarios across both specs are now COMPLIANT. Remaining items are non-blocking: one already-approved and logged deviation (direct-to-production apply instead of branch-first) and one scope note (no Supabase MCP access in this session to re-run `get_advisors`, mitigated by the unchanged, byte-identical SQL). Clean to archive.
