# 🗄️ Base de Datos y Políticas de Seguridad (RLS)

La base de datos de **ERP Tiendas** está alojada en PostgreSQL a través de Supabase. El esquema está definido en `migration.sql` e implementa seguridad multinivel mediante Row Level Security (RLS) y Triggers automáticos.

---

## 📊 Esquema de Tablas

### 1. `stores` (Tiendas)
Tabla maestra de comercios registrados.
- `id` (`uuid`, PK, `gen_random_uuid()`): Identificador único de la tienda.
- `name` (`text`, NOT NULL): Nombre comercial de la tienda.
- `thermal_paper_width` (`text`, DEFAULT `'58mm'`, CHECK `in ('58mm', '80mm')`): Configuración del ancho de papel térmico para tickets.
- `created_at` (`timestamptz`, DEFAULT `now()`): Fecha de registro.

### 1.1 `branches` (Sucursales)
Ubicaciones físicas de una tienda. Toda tienda tiene al menos una sucursal en todo momento.
- `id` (`uuid`, PK, `gen_random_uuid()`): Identificador único de la sucursal.
- `store_id` (`uuid`, FK -> `stores.id` ON DELETE CASCADE, NOT NULL): Tienda a la que pertenece.
- `name` (`text`, NOT NULL, CHECK no vacío tras `btrim`): Nombre de la sucursal.
- `is_active` (`boolean`, NOT NULL, DEFAULT `true`): Desactivación lógica (soft-delete). Nunca se hace `DELETE` de una sucursal referenciada por un perfil.
- `created_at` / `updated_at` (`timestamptz`, DEFAULT `now()`): Timestamps de auditoría.

Al registrarse una tienda nueva, `handle_new_user()` crea automáticamente una sucursal "Sucursal Principal" en la misma transacción.

### 3. `clients` (Clientes)
Directorio de clientes de cada tienda.
- `id` (`uuid`, PK, `gen_random_uuid()`): Identificador único del cliente.
- `store_id` (`uuid`, FK -> `stores.id` ON DELETE CASCADE, NOT NULL): Tienda asociada.
- `name` (`text`): Nombre completo del cliente.
- `phone` (`text`): Número telefónico (utilizado para vincular o enviar comprobantes).
- `created_at` (`timestamptz`, DEFAULT `now()`): Fecha de registro.

### 4. `sales` (Ventas / Transacciones)
Registro de ventas procesadas en el local.
- `id` (`uuid`, PK, `gen_random_uuid()`): ID de la transacción.
- `store_id` (`uuid`, FK -> `stores.id` ON DELETE CASCADE, NOT NULL): Tienda emisora.
- `employee_id` (`uuid`, FK -> `profiles.id` ON DELETE SET NULL): Empleado o admin que registró la venta.
- `description` (`text`, NOT NULL): Detalle o productos de la venta (soporta formato JSON de ítems y etiquetas de pago combinado).
- `payment_method` (`text`, CHECK `in ('cash', 'transfer', 'card')`, NOT NULL): Medio de pago.
- `total_amount` (`numeric(10,2)`, NOT NULL): Monto total de la operación.
- `client_id` (`uuid`, FK -> `clients.id` ON DELETE SET NULL): Cliente asociado (opcional).
- `branch_id` (`uuid`, NULL, FK -> `branches.id` ON DELETE NO ACTION): Sucursal donde se registró la venta. Desde la sección 16 ("Granular Roles"), las políticas RLS de `sales` usan la **Forma D** (sucursal y división por verbo — ver la tabla de RLS y "Formas de Predicados RLS" más abajo): `admin`/`superadmin` operan a nivel de tienda completa, mientras que `encargado`/`caja`/`employee` quedan acotados a su propia sucursal. Se completa en cada inserción nueva (empleado: su propia sucursal; admin: la sucursal seleccionada en el panel), pero queda `NULL` en ventas anteriores a este cambio.
- `created_at` (`timestamptz`, DEFAULT `now()`): Timestamp de la venta.

### 5. `product_price_rules` (Reglas de Precio / Stock)
Configuración de precios unitarios y promocionales por cantidad.
- `id` (`uuid`, PK, `gen_random_uuid()`): ID de la regla.
- `store_id` (`uuid`, FK -> `stores.id` ON DELETE CASCADE, NOT NULL): Tienda asociada.
- `product_name` (`text`, NOT NULL): Nombre o categoría del producto.
- `quantity` (`int`, NOT NULL): Cantidad mínima para aplicar precio especial (ej. 12 para docena).
- `special_price` (`numeric(10,2)`, NOT NULL): Precio total por la cantidad promocional.
- `unit_price` (`numeric(10,2)`, NOT NULL): Precio unitario por defecto.
- `created_at` (`timestamptz`, DEFAULT `now()`): Fecha de creación.

### 7. `categories` (Categorías de Productos)
- `id` (`uuid`, PK, `gen_random_uuid()`): Identificador único.
- `store_id` (`uuid`, FK -> `stores.id` ON DELETE CASCADE, NOT NULL): Tienda asociada.
- `name` (`text`, NOT NULL, CHECK no vacío tras `btrim`): Nombre de la categoría (ej. "Bebidas").
- `is_active` (`boolean`, NOT NULL, DEFAULT `true`): Desactivación lógica.
- `created_at` / `updated_at` (`timestamptz`, DEFAULT `now()`): Timestamps de auditoría.

### 8. `products` (Catálogo de Productos)
- `id` (`uuid`, PK, `gen_random_uuid()`): Identificador único.
- `store_id` (`uuid`, FK -> `stores.id` ON DELETE CASCADE, NOT NULL): Tienda asociada. `UNIQUE (store_id, id)` para que `branch_stock`/`stock_movements` puedan referenciar el par sin permitir una combinación de tienda ajena (ver "Claves de coherencia" abajo).
- `category_id` (`uuid`, NULL, FK -> `categories.id` ON DELETE SET NULL): Categoría del producto.
- `name` (`text`, NOT NULL, CHECK no vacío tras `btrim`): Nombre del producto.
- `barcode` (`text`, **NOT NULL** desde Stock Phase 2, `UNIQUE` globalmente, `DEFAULT public.next_product_code()`, CHECK EAN-8): Código de barras EAN-8 de 8 dígitos, generado por el sistema — ver "Generación de códigos EAN-8" abajo. Ningún formulario permite escribirlo o editarlo.
- `purchase_price` / `sale_price` (`numeric(10,2)`, NOT NULL, DEFAULT `0`, CHECK `>= 0`): Precio de costo y de venta.
- `is_active` (`boolean`, NOT NULL, DEFAULT `true`): Desactivación lógica.
- `created_at` / `updated_at` (`timestamptz`, DEFAULT `now()`): Timestamps de auditoría.

`products` **no tiene columna de stock**: la cantidad depende de la sucursal y vive exclusivamente en `branch_stock` (ver abajo).

### 9. `sale_items` (Líneas de Venta)
- `id` (`uuid`, PK, `gen_random_uuid()`): Identificador único.
- `store_id` (`uuid`, FK -> `stores.id` ON DELETE CASCADE, NOT NULL): Denormalizado desde `sales.store_id` para simplificar RLS.
- `sale_id` (`uuid`, FK -> `sales.id` ON DELETE CASCADE, NOT NULL): Venta a la que pertenece la línea.
- `product_id` (`uuid`, NULL, FK -> `products.id` ON DELETE SET NULL): Producto vendido; `NULL` si no se pudo resolver por nombre o si la venta es previa a la existencia del catálogo.
- `product_name` (`text`, NOT NULL): Nombre del producto al momento de la venta (sobrevive a la eliminación/desactivación del producto).
- `quantity` (`int`, NOT NULL): Cantidad vendida.
- `unit_price` / `subtotal` (`numeric(10,2)`, NOT NULL): Precio unitario y subtotal al momento de la venta.
- `branch_id` (`uuid`, NULL, desde Stock Phase 2): Denormalizado desde `sales.branch_id` por el trigger `set_sale_item_branch()` — ver "Movimientos de stock por venta" abajo. `NULL` para ventas previas a `store-branches`.

### 10. `branch_stock` (Stock por Sucursal) — Stock Phase 2
Balance de stock actual de cada producto en cada sucursal. **Clave primaria compuesta, sin `id` sustituto** — el par `(branch_id, product_id)` es la identidad; ver la nota de diseño en `openspec/changes/stock-phase2-quantities-movements/design.md`.
- `store_id` (`uuid`, FK -> `stores.id` ON DELETE CASCADE, NOT NULL): Denormalizado para RLS.
- `branch_id` (`uuid`, NOT NULL): Parte de la PK. `FOREIGN KEY (store_id, branch_id) REFERENCES branches (store_id, id)`.
- `product_id` (`uuid`, NOT NULL): Parte de la PK. `FOREIGN KEY (store_id, product_id) REFERENCES products (store_id, id)`.
- `current_stock` (`int`, NOT NULL, DEFAULT `0`, CHECK `>= 0`): Cantidad actual. Nunca negativa — las salidas se recortan (`clamp`) en cero.
- `min_stock` (`int`, NOT NULL, DEFAULT `0`, CHECK `>= 0`): Columna reservada para alertas de stock mínimo (sin comportamiento en esta fase; Fase 7).
- `created_at` / `updated_at` (`timestamptz`, DEFAULT `now()`): Timestamps.

Una fila inexistente **no es un error**: se crea bajo demanda en `current_stock = 0` la primera vez que ese par `(branch_id, product_id)` se referencia (venta, ajuste o importación), mediante `INSERT ... ON CONFLICT (branch_id, product_id) DO UPDATE ... RETURNING current_stock` — esto crea y toma el lock de fila en un solo paso atómico.

### 11. `stock_movements` (Ledger de Movimientos de Stock) — Stock Phase 2
Ledger de solo-inserción (append-only) que explica cada cambio de `current_stock`.
- `id` (`uuid`, PK, `gen_random_uuid()`).
- `store_id` / `branch_id` / `product_id` (`uuid`, NOT NULL): mismas claves compuestas de coherencia que `branch_stock`.
- `sale_item_id` (`uuid`, NULL, **sin FK**): a propósito — la reversión se escribe en un `AFTER DELETE` cuando la fila de `sale_items` ya no existe; un FK con `ON DELETE CASCADE` borraría el propio registro de auditoría que esta tabla existe para preservar.
- `reason` (`text`, NOT NULL, CHECK `in ('sale', 'sale_reversal', 'manual_adjustment', 'restock', 'import_ingress')`).
- `quantity_delta` (`int`, NOT NULL, CHECK `<> 0`): delta solicitado (para auditoría).
- `applied_delta` (`int`, NOT NULL): delta realmente aplicado — difiere de `quantity_delta` solo cuando una venta se recorta en cero (oversell).
- `resulting_balance` (`int`, NOT NULL, CHECK `>= 0`): `current_stock` resultante.
- `note` (`text`, NULL), `created_at` (`timestamptz`, DEFAULT `now()`).

Inmutable por diseño en dos capas: RLS solo define políticas `SELECT`/`INSERT` (sin `UPDATE`/`DELETE`, por lo que RLS deniega ambos verbos por defecto), y además `REVOKE UPDATE, DELETE ... FROM authenticated, anon` a nivel de privilegios, para que el ledger siga siendo inmutable aunque una política futura se amplíe por error.

### 12. `cash_sessions` (Sesiones de Caja) — Cash Register (sección 17)
Turno de caja por sucursal. `admin`/`superadmin` pueden abrir/cerrar en cualquier sucursal de su tienda; `encargado`/`caja`/`employee` solo en la propia.
- `id` (`uuid`, PK, `gen_random_uuid()`).
- `store_id` (`uuid`, FK -> `stores.id` ON DELETE CASCADE, NOT NULL).
- `branch_id` (`uuid`, NOT NULL): `FOREIGN KEY (store_id, branch_id) REFERENCES branches (store_id, id)`. `UNIQUE (branch_id, id)` es la clave de coherencia que usa `sales.cash_session_id` (mismo patrón que sección 15.1).
- `opened_by` / `closed_by` (`uuid`, NULL, FK -> `profiles.id` ON DELETE SET NULL).
- `opened_at` (`timestamptz`, DEFAULT `now()`), `closed_at` (`timestamptz`, NULL).
- `opening_amount` (`numeric(10,2)`, NOT NULL, DEFAULT `0`, CHECK `>= 0`): fondo inicial, ingresado por la persona que abre.
- `status` (`text`, CHECK `in ('open','closed')`, DEFAULT `'open'`).
- `counted_amount` / `expected_amount` / `discrepancy` (`numeric(10,2)`, NULL mientras `status='open'`): calculados y **congelados una única vez** al cerrar — nunca se recalculan después, ni siquiera si un admin edita una venta de una sesión ya cerrada.
- CHECK `cash_sessions_closed_shape`: una sesión `open` tiene los cuatro campos de cierre en `NULL`; una `closed` los tiene todos completos. Forma exhaustiva, sin estado intermedio posible.

**Invariante de base de datos** (no solo de UI): `CREATE UNIQUE INDEX cash_sessions_one_open_per_branch_idx ON cash_sessions (branch_id) WHERE status = 'open'` — a lo sumo una sesión abierta por sucursal. Un segundo `INSERT` concurrente falla con `23505` (unique violation), que la UI traduce a "ya hay una sesión abierta en esta sucursal".

Abrir es un `INSERT` común protegido por RLS (Forma B, ver abajo) — el índice parcial ya resuelve la condición de carrera atómicamente, así que no hace falta un RPC para abrir. **Cerrar sí es un RPC** (`close_cash_session`, ver abajo): es la única vía de mutación posible, porque `expected_amount`/`discrepancy` son valores derivados que no pueden quedar expuestos a un `UPDATE` directo del cliente.

### 13. `cash_movements` (Ledger de Caja) — Cash Register (sección 17)
Ledger de solo-inserción para entradas/salidas manuales de efectivo — nunca duplica el efectivo generado por una venta (eso se deriva con un `JOIN` a `sales WHERE payment_method='cash'`).
- `id` (`uuid`, PK, `gen_random_uuid()`).
- `cash_session_id` (`uuid`, FK -> `cash_sessions.id` ON DELETE CASCADE, NOT NULL).
- `store_id` / `branch_id` (`uuid`, NOT NULL): mismas claves de coherencia que otras tablas por sucursal.
- `type` (`text`, CHECK `in ('cash_in','cash_out')`, NOT NULL).
- `amount` (`numeric(10,2)`, NOT NULL, CHECK `> 0`).
- `reason` (`text`, NOT NULL, CHECK no vacío tras `btrim`), `note` (`text`, NULL).
- `created_by` (`uuid`, NULL, FK -> `profiles.id` ON DELETE SET NULL), `created_at` (`timestamptz`, DEFAULT `now()`).

Inmutable en las mismas dos capas que `stock_movements`: RLS sin políticas `UPDATE`/`DELETE` (deniega por defecto) + `REVOKE UPDATE, DELETE FROM authenticated, anon`. Un movimiento insertado **después** de cerrada su sesión es válido y esperado — es la vía de corrección post-cierre (ver `docs/features.md`); el número congelado de la sesión no se altera.

### `sales.cash_session_id` — Atribución de venta a caja (sección 17.4-17.5)
- `cash_session_id` (`uuid`, NULL, `FOREIGN KEY (branch_id, cash_session_id) REFERENCES cash_sessions (branch_id, id) ON DELETE SET NULL`): a qué sesión de caja pertenece la venta. **Ninguna venta se bloquea nunca por el estado de la caja** — si no hay sesión abierta en la sucursal, queda `NULL` (sin atribuir), igual que `sale_items.product_id` para un nombre no reconocido.
- Trigger `enforce_sale_cash_session()` (`BEFORE INSERT` en `sales`, `SECURITY INVOKER`): si el `cash_session_id` adjunto no existe, no pertenece a esa sucursal, o ya no está `open`, lo degrada silenciosamente a `NULL` — nunca rechaza el `INSERT`. Es el respaldo para la ventana de milisegundos entre que el cliente resuelve la sesión abierta y el `INSERT` realmente corre.
- Resolución en el cliente (`src/lib/cashSession.ts`, `fetchOpenSession`): cada uno de los puntos de venta (`/pos`, `src/components/pos/PosShell.tsx`; `SaleModal.tsx` alta/edición) resuelve la sesión abierta de la sucursal **en el momento del submit**, nunca desde estado cacheado — todas las filas de un pago combinado comparten el mismo id resuelto.

### `close_cash_session(p_session_id, p_counted_amount)` — RPC de cierre (sección 17.6)
`SECURITY DEFINER` (a propósito, no `SECURITY INVOKER`): el cliente no tiene ningún `GRANT UPDATE` sobre `cash_sessions`, así que `expected_amount`/`discrepancy` no pueden falsificarse desde un `PATCH` directo. La autorización se hace **dentro del cuerpo de la función**, replicando el patrón de `preload_employee`:
1. `SELECT ... FOR UPDATE` sobre la sesión (serializa dos cierres concurrentes de la misma sesión).
2. Verifica tienda (mismo mensaje genérico "Cash session not found" para "no existe" y "es de otra tienda", para no filtrar existencia) y rol/sucursal (`admin`/`superadmin`: cualquier sucursal de su tienda; `encargado`/`caja`/`employee`: solo la propia).
3. Rechaza si la sesión ya no está `open` ("Cash session is already closed") — una sesión cerrada **nunca se reabre**.
4. Calcula `expected_amount = opening_amount + Σ(ventas en efectivo de la sesión) + Σ(cash_in) − Σ(cash_out)` y `discrepancy = counted_amount − expected_amount`, y los persiste en una sola transacción junto con `status='closed'`, `closed_by`, `closed_at`.

`GRANT EXECUTE ... TO authenticated` + `REVOKE EXECUTE ... FROM PUBLIC, anon` porque toda función `SECURITY DEFINER` en `public` es ejecutable por `PUBLIC` (y por herencia `anon`/`authenticated`) salvo que se revoque explícitamente.

### 6. `allowed_admins` (Lista Blanca de Administradores)
Gestionada por el `superadmin` para habilitar el registro de nuevas tiendas.
- `id` (`uuid`, PK, `gen_random_uuid()`): ID del registro.
- `email` (`text`, UNIQUE, NOT NULL): Email autorizado para crear una tienda.
- `store_name` (`text`, NOT NULL): Nombre de la tienda pre-aprobada.
- `created_at` (`timestamptz`, DEFAULT `now()`): Fecha de autorización.

---

## ⚙️ Funciones Auxiliares & Triggers PL/pgSQL

### 1. `get_current_user_store_id()`
```sql
CREATE OR REPLACE FUNCTION public.get_current_user_store_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT store_id FROM public.profiles WHERE id = auth.uid();
$$;
```

### 2. `get_current_user_role()`
```sql
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;
```

### 2.1 `get_current_user_branch_id()`
```sql
CREATE OR REPLACE FUNCTION public.get_current_user_branch_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT branch_id FROM public.profiles WHERE id = auth.uid();
$$;
```
Devuelve la sucursal del usuario autenticado: `NULL` para `admin`/`superadmin`, no nulo para `employee` (garantizado por `profiles_employee_branch_check`).

### 3. Trigger `on_auth_user_created` (`handle_new_user()`)
Se ejecuta automáticamente cada vez que un usuario se registra en `auth.users`:
1. Si el correo coincide con un perfil pre-cargado por un administrador (`preload_employee`), re-vincula la cuenta asignando el `auth.users.id` definitivo y eliminando el perfil ficticio temporal.
2. Si es un registro nuevo de administrador, verifica la existencia del email en `allowed_admins`. Si existe, crea la tienda (`stores`), crea el perfil con rol `admin` y remueve la autorización de la lista blanca. Si no está en la lista blanca, la transacción se aborta con error de autorización.

### 4. Procedimientos Almacenados de Administración:
- `public.preload_employee(p_email, p_name, p_role, p_store_id, p_branch_id)`: Permite a un administrador pre-crear un perfil de empleado antes de que este inicie sesión con Google. `p_branch_id` es obligatorio cuando `p_role = 'employee'` y debe pertenecer a `p_store_id`.
- `public.update_employee_user(p_employee_id, p_name, p_email, p_branch_id)`: Actualiza nombre, correo y sucursal de un empleado sincronizando `profiles` y `auth.users`. `p_branch_id` es obligatorio cuando el perfil objetivo es `employee`.
- `public.delete_employee_user(p_employee_id)`: Desvincula las ventas (preservando el historial) y elimina el usuario de `auth.users` y `profiles`.

> Ambas funciones fueron `DROP FUNCTION` + `CREATE FUNCTION` (no `CREATE OR REPLACE`) al agregar `p_branch_id`, porque en Postgres el número de argumentos forma parte de la identidad de la función: un `CREATE OR REPLACE` con un parámetro extra crea un *overload* nuevo en lugar de reemplazar la firma anterior.

### 5. Generación de código EAN-8 — Stock Phase 2

`products.barcode` se genera automáticamente: nunca se escribe ni se edita desde la UI.

- `public.product_code_seq`: secuencia global (`bigint`, 1 a 9.999.999) — **global**, no por tienda, porque el código debe ser único en todo el sistema.
- `public.ean8_check_digit(payload text) RETURNS int`: calcula el dígito verificador EAN-8 estándar (GS1) sobre un payload de 7 dígitos. Posiciones impares (1,3,5,7 desde la izquierda) pesan 3; posiciones pares (2,4,6) pesan 1 — el espejo exacto de la ponderación de EAN-13.
- `public.next_product_code() RETURNS text`: toma el siguiente valor de la secuencia, lo rellena a 7 dígitos con ceros a la izquierda y le agrega el dígito verificador. Es el `DEFAULT` de `products.barcode`.
- El índice único pasó de `products_store_barcode_uidx (store_id, barcode)` (Phase 1, per-tienda) a `products_barcode_uidx (barcode)` (Phase 2, global) — el mismo código de 8 dígitos no puede existir en dos tiendas distintas.

### 6. Movimientos de stock por venta — Stock Phase 2

- `public.set_sale_item_branch()` (`BEFORE INSERT` en `sale_items`): copia `sales.branch_id` a `NEW.branch_id` si viene `NULL`. Es necesario porque `apply_sale_item_stock()` no puede hacer `JOIN` a `sales` en su `AFTER DELETE`: el cascade de `DELETE FROM sales` ya borró la fila padre para ese momento, así que el `branch_id` debe sobrevivir denormalizado en la propia fila de `sale_items`.
- `public.apply_sale_item_stock()` (`AFTER INSERT` y `AFTER DELETE` en `sale_items`, una sola función para ambas direcciones):
  - En `INSERT`: descuenta `quantity` de `branch_stock` en `(sales.branch_id, product_id)`, recortado en cero (nunca bloquea la venta), y registra un movimiento `reason = 'sale'` con el delta solicitado y el delta realmente aplicado.
  - En `DELETE` (borrado directo, edición vía borrar-y-recrear, o cascada desde `sales`): revierte exactamente el `applied_delta` del movimiento `'sale'` previo (no el `quantity_delta` solicitado), para que una venta recortada en cero se revierta a su balance real y no "invente" unidades. Registra `reason = 'sale_reversal'`.
  - Líneas con `product_id IS NULL` o `branch_id IS NULL` (venta sin producto resuelto, o venta anterior a `store-branches`) no afectan stock.
- `public.adjust_branch_stock(p_branch_id, p_product_id, p_delta, p_reason, p_note) RETURNS int`: único punto de ajuste manual/importación. Solo `admin`/`superadmin` (verificado dentro de la función); valida que la sucursal pertenezca a la tienda del producto (contra un admin escribiendo `branch_stock` con una sucursal ajena a través de un `product_id` válido); usa el mismo patrón atómico `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` que el trigger de venta. `p_reason` acepta `'manual_adjustment'`, `'restock'` o `'import_ingress'`.

---

### 2. `profiles` (Perfiles de Usuarios)
Asocia los usuarios de `auth.users` a una tienda y determina su rol en la plataforma.
- `id` (`uuid`, PK, FK -> `auth.users.id` ON DELETE CASCADE): ID de autenticación.
- `store_id` (`uuid`, FK -> `stores.id` ON DELETE CASCADE): Tienda a la que pertenece el usuario.
- `email` (`text`, UNIQUE): Correo electrónico del usuario.
- `name` (`text`): Nombre legible del usuario.
- `role` (`text`, CHECK `in ('admin', 'encargado', 'caja', 'stock', 'employee', 'superadmin')`): Rol dentro del sistema.
- `branch_id` (`uuid`, NULL, FK -> `branches.id` ON DELETE NO ACTION): Sucursal asignada. Obligatorio (`NOT NULL`) para `encargado`, `caja`, `stock`, `employee`; `admin` y `superadmin` quedan obligatoriamente en `NULL`. CHECK `profiles_employee_branch_check`: `CASE WHEN role IN ('encargado','caja','stock','employee') THEN branch_id IS NOT NULL WHEN role IN ('admin','superadmin') THEN branch_id IS NULL ELSE true END`.
- `created_at` (`timestamptz`, DEFAULT `now()`): Fecha de creación del perfil.

---

## 📈 Store Analytics — agregación de solo lectura (secciones 18-19)

Seis objetos SQL de solo lectura que alimentan el panel `/analytics` (`AnalyticsShell.tsx`). Ninguno muta datos. Todos son `SECURITY INVOKER` (la vista usa el equivalente `security_invoker = true`), así que las políticas RLS ya existentes de las tablas base (`branch_stock`, `products`, `sales`/`sale_items`, `cash_sessions`) hacen el trabajo de scoping — la única excepción es `analytics_branch_comparison`, que re-deriva el predicado a mano (ver abajo).

### `analytics_low_stock` (vista, sección 18.2)
`CREATE VIEW ... WITH (security_invoker = true)`. Sin `security_invoker = true` la vista correría con los permisos del owner (`postgres`, que ignora RLS) y expondría todas las tiendas. Devuelve una fila por cada par `(branch_id, product_id)` de `branch_stock` donde `min_stock > 0 AND current_stock <= min_stock` y el producto está activo, con el nombre de sucursal/producto y el código de barras ya resueltos. `min_stock` es `NOT NULL DEFAULT` (ver sección 20 más abajo), por lo que "sin configurar" es exactamente `0` — no hay un caso `NULL` que manejar.

### `analytics_product_ranking(p_from, p_to, p_branch_id DEFAULT NULL)` (función, sección 18.3)
`SECURITY INVOKER STABLE`. Rankea productos por unidades vendidas, ingresos y margen (estimado con precios actuales del catálogo, y realizado con el precio de costo vigente al momento de la consulta) en el rango `[p_from, p_to)`. Excluye líneas legacy sin `product_id` resuelto. La política `SELECT` de `sale_items` (Forma D) ya limita a un `encargado` a su propia sucursal; `p_branch_id` solo puede acotar más, nunca ampliar.

### `analytics_branch_comparison(p_from, p_to)` (función, sección 18.4)
`SECURITY INVOKER STABLE`. **El único objeto que re-deriva el scoping a mano.** `branches` tiene lectura de tienda completa (Forma A/C), así que conducir el `FROM` directamente desde `branches` filtraría los números por RLS pero no ocultaría las sucursales ajenas — un `encargado` vería una fila en cero por cada sucursal hermana en vez de no verla. El predicado explícito `WHERE ... AND (role IN ('admin','superadmin') OR b.id = get_current_user_branch_id())` es lo que fuerza la decisión resuelta "encargado ve únicamente su propia sucursal". `sales_count` replica el agrupado por `Ref:` de `groupSales()` (`salesHelper.ts`) para que un pago combinado cuente como una sola operación, igual que en el Dashboard.

### `analytics_cash_discrepancy(p_from, p_to, p_branch_id DEFAULT NULL)` (función, sección 18.5)
`SECURITY INVOKER STABLE`. Devuelve una fila por sesión de caja **cerrada** (no un agregado pre-agrupado) en el rango dado, con el nombre de quien cerró la caja. El `LEFT JOIN` a `profiles` es solo para mostrar el nombre de `closed_by` sobre filas ya acotadas por el propio scoping de `cash_sessions` — no es una tabla conductora que necesite predicado adicional. **No usada actualmente por la UI** (`CashDiscrepancyPanel` no existe en `src/`) — deuda documentada, no un hallazgo nuevo.

### `analytics_sales_trend(p_from, p_to, p_branch_id DEFAULT NULL)` (función, sección 19.1)
`SECURITY INVOKER STABLE`. Serie diaria de ingresos (`SUM(total_amount)` agrupado por día) en el rango dado. Conducida desde `sales`, ya acotada por su propia RLS Forma D para `encargado` — a diferencia de `analytics_branch_comparison`, no necesita un predicado manual porque no conduce desde una tabla de lectura store-wide.

### `analytics_category_comparison(p_from, p_to, p_branch_id DEFAULT NULL)` (función, sección 19.2)
`SECURITY INVOKER STABLE`. Ingresos y unidades vendidas agrupados por categoría en el rango dado, conducida desde `sale_items` (misma herencia de scoping que `analytics_product_ranking`). `LEFT JOIN` a `categories` porque `products.category_id` es nullable (`ON DELETE SET NULL`); productos sin categoría se agrupan bajo `'Sin categoría'`.

### Permisos (secciones 18.6/19.3)
Mismo patrón revoke-then-grant que el resto de funciones `SECURITY DEFINER`/RPC del proyecto, aplicado aquí por higiene aunque estas funciones sean `SECURITY INVOKER`: `REVOKE EXECUTE ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO authenticated` en cada función; `GRANT SELECT ON analytics_low_stock TO authenticated` + `REVOKE ALL ... FROM anon` en la vista. Una vista/función `security_invoker`/`SECURITY INVOKER` además requiere que quien llama tenga `SELECT` sobre las tablas base — `branch_stock` ya lo otorga explícitamente; `products`/`sales`/`sale_items` lo tienen vía los privilegios por defecto de Supabase para `authenticated`.

### `branch_stock.min_stock` — cambio de valor por defecto (sección 20)
Antes de este follow-up, `min_stock` no era configurable desde ninguna UI y quedaba en `0` ("sin configurar") en absolutamente todas las filas, lo que dejaba `analytics_low_stock` permanentemente vacía. A pedido explícito del usuario: `ALTER TABLE branch_stock ALTER COLUMN min_stock SET DEFAULT 8` (para pares producto×sucursal nuevos) + `UPDATE branch_stock SET min_stock = 8` (para sembrar todas las filas existentes). Cambio puramente de datos/default — sin columna nueva, sin cambio de RLS. Cada fila sigue siendo editable individualmente después vía `StockAdjustDialog`.

---

## 🛡️ Políticas de Row Level Security (RLS)

| Tabla | Operaciones | Condición de Permiso (`USING` / `WITH CHECK`) |
| :--- | :--- | :--- |
| `stores` | ALL | `id = public.get_current_user_store_id()` o `role = 'superadmin'` |
| `profiles` | SELECT | `store_id = public.get_current_user_store_id() OR id = auth.uid()` |
| `profiles` | ALL | Admins gestionan perfiles de su tienda; encargados gestionan únicamente `caja`/`stock`/`employee` de su propia sucursal con `WITH CHECK` CASE estricto |
| `categories` / `products` / `product_price_rules` | SELECT / ALL | **Forma C**: Lectura para toda la tienda (`SELECT`); escritura (`FOR ALL`) solo para `admin`, `superadmin` y `encargado` |
| `clients` | SELECT / ALL / INSERT | **Forma C**: Lectura para toda la tienda; escritura completa para `admin`, `superadmin`, `encargado`; `caja` y `employee` tienen permiso exclusivo de `INSERT` para crear clientes en caja |
| `sales` | SELECT / INSERT / UPDATE / DELETE | **Forma D**: Verb-split y sucursal. Admin/superadmin: global, **incondicional incluso sobre una sesión de caja cerrada**. Encargado: toda su sucursal. Caja/employee: sucursal propia para SELECT/INSERT, y UPDATE/DELETE limitado a sus propias ventas (`employee_id = auth.uid()`). Desde la sección 17.8, el UPDATE/DELETE de encargado/caja/employee **además** exige que `cash_session_id IS NULL` o que su sesión no esté `closed`. Stock: solo SELECT de su sucursal |
| `sale_items` | SELECT / INSERT / UPDATE / DELETE | **Forma D**: Mismo esquema que `sales`; UPDATE/DELETE de caja/employee validado mediante subquery `EXISTS` en `sales` por creador, extendida (17.8) para exigir también que la sesión de la venta padre no esté cerrada; el brazo de encargado gana la misma condición vía `NOT EXISTS (... cs.status = 'closed')` |
| `branches` | SELECT / ALL | SELECT para toda la tienda; escritura solo `admin`/`superadmin` |
| `branch_stock` | ALL (Forma B) | Admin/superadmin ven todas las sucursales; roles de sucursal (`encargado`, `caja`, `stock`, `employee`) solo su sucursal |
| `stock_movements` | SELECT + INSERT (Forma B) | Lectura e inserción según ámbito de sucursal; inmutable sin UPDATE/DELETE |
| `cash_sessions` | SELECT + INSERT (Forma B) | Lectura por sucursal (admin/superadmin global); abrir es un INSERT con `opened_by` fijado al llamante; sin política UPDATE/DELETE — cerrar es exclusivamente vía RPC `close_cash_session` |
| `cash_movements` | SELECT + INSERT (Forma B) | Lectura e inserción según ámbito de sucursal; inmutable sin UPDATE/DELETE (RLS + `REVOKE`), igual que `stock_movements` |

### Formas de Predicados RLS

1. **Forma A (Tienda completa)**: `store_id = public.get_current_user_store_id()`.
2. **Forma B (Sucursal simple)**: `store_id = get_current_user_store_id() AND (role IN ('admin','superadmin') OR branch_id = get_current_user_branch_id())`.
3. **Forma C (Tienda completa, escritura restringida por rol)**:
   - Lectura libre para usuarios autenticados de la misma tienda.
   - Escritura condicionada a `role IN ('admin', 'superadmin', 'encargado')`.
4. **Forma D (Sucursal y división por verbo / autoría)**:
   - `SELECT`: lectura según sucursal (`admin`/`superadmin` global; resto por `branch_id = get_current_user_branch_id()`).
   - `INSERT`: `admin`/`superadmin` global; `encargado`/`caja`/`employee` en su propia sucursal.
   - `UPDATE`/`DELETE`: `admin`/`superadmin` global; `encargado` en su sucursal; `caja`/`employee` en su sucursal y únicamente si `employee_id = (select auth.uid())` (en `sale_items` vía subconsulta `EXISTS`).
   - Desde la sección 17.8, el `UPDATE`/`DELETE` de `encargado`/`caja`/`employee` exige además `cash_session_id IS NULL OR EXISTS (SELECT 1 FROM cash_sessions cs WHERE cs.id = cash_session_id AND cs.status = 'open')` — escrita en forma **fail-closed**: si la fila de `cash_sessions` referenciada llegara a ser invisible para el llamante bajo RLS, el `EXISTS` da `false` y la política deniega, en vez de la forma `NOT EXISTS (... status = 'closed')` que fallaría *abierta* (permitiendo la edición) ante la misma invisibilidad. `admin`/`superadmin` quedan exentos de esta condición — mantienen acceso incondicional, consistente con que ya son incondicionales en el resto de la Forma D.

### 🔒 Inmutabilidad post-cierre de caja (sección 17.8)

Una vez que una sesión de `cash_sessions` pasa a `status = 'closed'`, sus ventas (`sales`) y líneas (`sale_items`) dejan de ser editables/eliminables para `encargado`/`caja`/`employee` — el número reconciliado (`expected_amount`/`discrepancy`) no puede quedar desincronizado de las filas que lo originaron. `admin`/`superadmin` están exentos (pueden seguir corrigiendo directamente si es necesario), pero la vía recomendada y auditable para cualquier rol es un movimiento en `cash_movements` (ver `docs/features.md`) — la sesión cerrada nunca se reabre ni se recalcula.

