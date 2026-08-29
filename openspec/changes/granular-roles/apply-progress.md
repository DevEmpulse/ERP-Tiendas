# Apply Progress: granular-roles

**Status:** Implementation Complete (Ready for DB Apply & Verification)
**Started:** 2026-08-29
**Completed:** 2026-08-29
**Strategy:** Single PR (`size:exception` approved)

## Phases

- [ ] Phase 0: Pre-Apply Probes (Requires Orchestrator / Supabase access)
- [x] Phase 1: Role Model + RPCs + Constraints (§16.1–16.3 + UserManager RPC patch)
- [x] Phase 2: Shape C/D RLS Closure (§16.4–16.5 + `src/lib/roles.ts` + catalog rename guard)
- [x] Phase 3: Profiles Escalation Fix + Generalized Branch CHECK (§16.6–16.8 + docs)
- [x] Phase 4: `/encargado` Route Tree (`proxy.ts`, `sidebar-items.ts`, `AdminSidebar.tsx`, `EncargadoSidebar.tsx`, `app/encargado/page.tsx`, `app/admin/page.tsx`)
- [x] Phase 5: `/employee` Stock Arm (`StockAdjustDialog.tsx`, `StockView.tsx`, `StockAdjustmentView.tsx`, `employee-dashboard.tsx`, `app/employee/page.tsx`)
- [x] Phase 6: `/employee` Caja Arm (`salesHelper.ts`, `MySalesView.tsx`, `SaleModal.tsx`, `employee-dashboard.tsx`)
- [x] Phase 7: `UserManager` Role Rework + Final Gate (`UserManager.tsx`, `StaffManagementView.tsx`, `pnpm run build` [PASS], docs)
