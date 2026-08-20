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
- `created_at` (`timestamptz`, DEFAULT `now()`): Fecha de creación del perfil.

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

### 3. Trigger `on_auth_user_created` (`handle_new_user()`)
Se ejecuta automáticamente cada vez que un usuario se registra en `auth.users`:
1. Si el correo coincide con un perfil pre-cargado por un administrador (`preload_employee`), re-vincula la cuenta asignando el `auth.users.id` definitivo y eliminando el perfil ficticio temporal.
2. Si es un registro nuevo de administrador, verifica la existencia del email en `allowed_admins`. Si existe, crea la tienda (`stores`), crea el perfil con rol `admin` y remueve la autorización de la lista blanca. Si no está en la lista blanca, la transacción se aborta con error de autorización.

### 4. Procedimientos Almacenados de Administración:
- `public.preload_employee(p_email, p_name, p_role, p_store_id)`: Permite a un administrador pre-crear un perfil de empleado antes de que este inicie sesión con Google.
- `public.update_employee_user(p_employee_id, p_name, p_email)`: Actualiza nombre y correo de un empleado sincronizando `profiles` y `auth.users`.
- `public.delete_employee_user(p_employee_id)`: Desvincula las ventas (preservando el historial) y elimina el usuario de `auth.users` y `profiles`.

---

## 🛡️ Políticas de Row Level Security (RLS)

| Tabla | Operaciones | Condición de Permiso (`USING` / `WITH CHECK`) |
| :--- | :--- | :--- |
| `stores` | ALL | `id = public.get_current_user_store_id()` o `role = 'superadmin'` |
| `profiles` | SELECT | `store_id = public.get_current_user_store_id() OR id = auth.uid()` |
| `profiles` | ALL | `store_id = public.get_current_user_store_id() AND (id = auth.uid() OR role = 'admin')` |
| `clients` | ALL | `store_id = public.get_current_user_store_id()` |
| `sales` | ALL | `store_id = public.get_current_user_store_id()` |
| `product_price_rules` | ALL | `store_id = public.get_current_user_store_id()` |
| `allowed_admins` | ALL | `public.get_current_user_role() = 'superadmin'` |
