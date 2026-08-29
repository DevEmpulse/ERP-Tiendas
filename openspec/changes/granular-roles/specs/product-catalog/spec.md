# Delta for Product Catalog

## MODIFIED Requirements

### Requirement: Row-Level Security Isolation for Categories and Products

Every `categories` and `products` row MUST be readable only by authenticated
users belonging to that row's `store_id`, via an RLS policy using
`store_id = public.get_current_user_store_id()`. Write access (INSERT,
UPDATE, DELETE) additionally narrows to `admin`, `superadmin`, and
`encargado` roles of that `store_id`; `caja`, `stock`, and legacy `employee`
MUST remain able to read but MUST NOT be able to write.
(Previously: any authenticated member of the store could read AND write,
guarded only by `store_id`, with no role predicate at all.)

#### Scenario: Cross-tenant read returns zero rows

- GIVEN a user from store A is authenticated
- WHEN they query `products` or `categories` filtered to store B's `id`
- THEN zero rows are returned

#### Scenario: Cross-tenant write is rejected

- GIVEN a user from store A is authenticated
- WHEN they attempt to insert or update a `products`/`categories` row
  carrying store B's `store_id`
- THEN the write is rejected by the RLS policy's WITH CHECK clause

#### Scenario: Every role reads the store's catalog

- GIVEN a `caja`, `stock`, `encargado`, or `admin` profile of store A
- WHEN they SELECT from `products` or `categories`
- THEN store A's rows are returned regardless of role

#### Scenario: Caja or stock cannot write to the catalog

- GIVEN an authenticated `caja` or `stock` profile of store A
- WHEN they attempt to INSERT, UPDATE, or DELETE a `products` or
  `categories` row in store A
- THEN zero rows are affected

#### Scenario: Encargado can write to the store-wide catalog

- GIVEN an authenticated `encargado` profile of store A
- WHEN they update a product's price or create a category
- THEN the write succeeds, store-wide, not limited to their own branch
