# Delta for Product Catalog

## MODIFIED Requirements

### Requirement: Row-Level Security Isolation for Categories and Products

Every `categories` and `products` row MUST be readable and writable only by
authenticated users belonging to that row's `store_id`, via RLS policies
using `store_id = public.get_current_user_store_id()`, matching the existing
pattern on `clients` and `product_price_rules`. Categories and products MUST
remain store-wide, not branch-scoped: this is a deliberate architectural
split now that `branches` exists — the catalog is shared across every branch
of a store, while stock and cash-register concerns are branch-scoped in
later phases. This policy MUST NOT gain a branch predicate.
(Previously: RLS isolation was store-wide by implicit default, with no
branch concept in the schema to contrast against.)

#### Scenario: Cross-tenant read returns zero rows

- GIVEN a user from store A is authenticated
- WHEN they query `products` or `categories` filtered to store B's `id`
- THEN zero rows are returned

#### Scenario: Cross-tenant write is rejected

- GIVEN a user from store A is authenticated
- WHEN they attempt to insert or update a `products`/`categories` row
  carrying store B's `store_id`
- THEN the write is rejected by the RLS policy's WITH CHECK clause

#### Scenario: Catalog is shared across a store's branches

- GIVEN store A has two branches, X and Y
- WHEN an employee assigned to branch X and an employee assigned to branch Y
  both query `products` or `categories`
- THEN both see the identical set of store A's catalog rows, with no
  branch-based filtering applied
