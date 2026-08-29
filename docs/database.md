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

### 2. `profiles` (Perfiles de Usuarios)
Asocia los usuarios de `auth.users` a una tienda y determina su rol en la plataforma.
- `id` (`uuid`, PK, FK -> `auth.users.id` ON DELETE CASCADE): ID de autenticación.
- `store_id` (`uuid`, FK -> `stores.id` ON DELETE CASCADE): Tienda a la que pertenece el usuario.
- `email` (`text`, UNIQUE): Correo electrónico del usuario.
- `name` (`text`): Nombre legible del usuario.
- `role` (`text`, CHECK `in ('admin', 'employee', 'superadmin')`): Rol dentro del sistema.
- `branch_id` (`uuid`, NULL, FK -> `branches.id` ON DELETE NO ACTION): Sucursal asignada. Obligatorio (`NOT NULL` vía CHECK) para `role = 'employee'`; `admin` y `superadmin` quedan en `NULL` y flotan sobre todas las sucursales de su tienda. CHECK `profiles_employee_branch_check`: `role <> 'employee' OR branch_id IS NOT NULL`.
- `created_at` (`timestamptz`, DEFAULT `now()`): Fecha de creación del perfil.

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
- `branch_id` (`uuid`, NULL, FK -> `branches.id` ON DELETE NO ACTION): Sucursal donde se registró la venta — atribución únicamente; las políticas RLS de `sales` siguen siendo a nivel de tienda completa (ver "Ambas formas de RLS" más abajo). Se completa en cada inserción nueva (empleado: su propia sucursal; admin: la sucursal seleccionada en el panel), pero queda `NULL` en ventas anteriores a este cambio.
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

## 🛡️ Políticas de Row Level Security (RLS)

| Tabla | Operaciones | Condición de Permiso (`USING` / `WITH CHECK`) |
| :--- | :--- | :--- |
| `stores` | ALL | `id = public.get_current_user_store_id()` o `role = 'superadmin'` |
| `profiles` | SELECT | `store_id = public.get_current_user_store_id() OR id = auth.uid()` |
| `profiles` | ALL | `store_id = public.get_current_user_store_id() AND (id = auth.uid() OR role = 'admin')` |
| `clients` | ALL | `store_id = public.get_current_user_store_id()` |
| `sales` | ALL | `store_id = public.get_current_user_store_id()` (sin predicado de sucursal — ver nota abajo) |
| `product_price_rules` | ALL | `store_id = public.get_current_user_store_id()` |
| `categories` / `products` | ALL | `store_id = public.get_current_user_store_id()` (catálogo compartido entre sucursales, ver "¿Qué forma usar?") |
| `branches` | SELECT | `store_id = public.get_current_user_store_id()` (toda la tienda puede leer) |
| `branches` | ALL (admin) | `store_id = public.get_current_user_store_id() AND get_current_user_role() IN ('admin','superadmin')` |
| `allowed_admins` | ALL | `public.get_current_user_role() = 'superadmin'` |
| `branch_stock` | ALL (Forma B) | Ver "Dos formas de RLS" abajo — admin/superadmin ven todas las sucursales de su tienda, empleados solo la propia |
| `stock_movements` | SELECT + INSERT (Forma B, sin UPDATE/DELETE) | Igual predicado que `branch_stock`, partido en dos políticas; ledger inmutable — ver tabla 11 arriba |

### Dos formas de RLS: tienda completa vs. sucursal

Desde que existe `branches`, conviven dos formas de predicado. **Regla para cualquier tabla nueva**: si las filas describen algo que la tienda *comparte* entre sucursales (catálogo, clientes, reglas de precio), usar la Forma A. Si describen algo que existe *en* una sucursal (stock, caja, contadores por sucursal), usar la Forma B.

```sql
-- Forma A — tabla de TIENDA COMPLETA (sin cambios; categories, products, sale_items, sales, clients)
CREATE POLICY "Users can manage <thing> in their store" ON public.<table>
  FOR ALL TO authenticated
  USING      (store_id = public.get_current_user_store_id())
  WITH CHECK (store_id = public.get_current_user_store_id());

-- Forma B — tabla de SUCURSAL (consumidores: branch_stock, stock_movements — Stock Phase 2)
-- Requiere: <table>.store_id uuid NOT NULL, <table>.branch_id uuid NOT NULL.
-- Admin/superadmin ven todas las sucursales de su tienda; empleados quedan
-- restringidos a su propia sucursal a nivel de base de datos.
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

`sales.branch_id` se agrega solo para atribución: la política de `sales` se mantiene en Forma A (tienda completa) deliberadamente, para que los empleados sigan viendo todas las ventas de su tienda, incluidas las históricas con `branch_id` NULL.

`stock_movements` usa la Forma B pero **partida** en dos políticas (`FOR SELECT` y `FOR INSERT`, con el mismo predicado booleano), sin una política `FOR ALL` — al no existir ninguna política de `UPDATE`/`DELETE`, RLS deniega ambos verbos por defecto, reforzando el carácter de ledger append-only.

### Claves de coherencia entre tienda y sucursal/producto

`branches` y `products` tienen además `UNIQUE (store_id, id)` (adicional a su PK simple). Esto permite que `branch_stock`/`stock_movements` declaren `FOREIGN KEY (store_id, branch_id) REFERENCES branches (store_id, id)` en lugar de un FK simple a `branches(id)`: sin la clave compuesta, un admin podría escribir `branch_stock(store_id = mi_tienda, branch_id = sucursal_de_otra_tienda)` — pasaría tanto RLS como un FK simple, y produciría una fila que nadie podría conciliar nunca. Costo aceptado: una fila con FK compuesta no es un objetivo de *embed* resoluble en PostgREST, así que la exportación de catálogo lee `products` y `branch_stock` en dos consultas separadas y las combina en el cliente.
