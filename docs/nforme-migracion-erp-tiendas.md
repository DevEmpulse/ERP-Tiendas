# Informe de Migración — ERP Tiendas → Gestión de Ventas y Stock

**Fecha:** 28/08/2026
**Objetivo del informe:** documentar el estado actual, el estado objetivo, el modelo de datos, las decisiones de diseño y el orden de implementación recomendado, para ejecutar la migración con Claude Code usando SDD (gentle-ai) sin perder control del alcance.

---

## 1. Resumen ejecutivo

El sistema actual es un ERP multi-tenant (Next.js 16 + Supabase) enfocado en registrar ventas con detalle de producto como texto libre. El objetivo es evolucionarlo a un sistema de **gestión de ventas y stock** con:

- Catálogo de productos real (con categorías y códigos de barra)
- Control de stock con alertas y carga rápida
- Apertura y cierre de caja
- Escaneo con pistola lectora en el punto de venta
- Impresión de tickets con detalle completo
- Generación e impresión de códigos de barra
- Análisis de datos con Chart.js (ventas, márgenes, rotación)
- Roles con permisos granulares (no solo por nombre de rol) para escalar gradualmente de "solo admin" a "admin + empleados con permisos específicos"

**Decisión de fondo:** el detalle de venta como texto libre no sirve más. Todo lo pedido (stock, categorías, análisis, códigos de barra, márgenes) depende de tener productos normalizados en tablas relacionales. Este es el cambio que habilita todo lo demás, por eso va primero.

---

## 2. Estado actual (resumen técnico)

| Aspecto | Estado actual |
|---|---|
| Productos | No existen como entidad. El detalle de venta se guarda como texto en `sales` |
| Categorías | No existen |
| Stock | No existe |
| Caja | No existe apertura/cierre; se vende sin sesión de caja |
| Roles | `superadmin`, `admin`, `employee` fijos, sin permisos granulares |
| Precio de compra/costo | No existe |
| Códigos de barra | No existen |
| Análisis | No hay (más allá de KPIs simples del dashboard) |
| Ticket/PDF | Generado con jsPDF a partir del texto libre de la venta |

---

## 3. Modelo de datos objetivo

> Nota: nombres de tabla y campo son sugeridos, ajustalos a la convención que ya uses (`snake_case` es consistente con lo que ya tenés).

### 3.1 `categories`
```sql
categories (
  id uuid pk,
  store_id uuid fk -> stores.id,
  name text not null,
  color text,           -- opcional, para distinguir en UI/POS
  created_at timestamptz default now()
)
```
RLS: idéntica al patrón ya usado (`store_id = get_current_user_store_id()`).

### 3.2 `products`
```sql
products (
  id uuid pk,
  store_id uuid fk -> stores.id,
  category_id uuid fk -> categories.id, nullable,
  name text not null,
  barcode text,               -- código escaneado o generado
  sku text,                   -- código interno opcional
  sale_price numeric not null,
  purchase_price numeric,     -- ver sección 3.6
  current_stock numeric not null default 0,
  min_stock numeric default 0,  -- umbral para alertas
  unit text default 'unidad',  -- unidad, kg, pack, etc.
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
)
```
- `barcode` debe tener índice único **por tienda** (`unique(store_id, barcode)`), no global, porque cada tienda podría generar sus propios códigos internos.
- `product_price_rules` (ya existente) pasa a referenciar `product_id` en vez de un campo de texto, si no lo hace ya.

### 3.3 `sale_items` (reemplaza el texto libre de `sales`)
```sql
sale_items (
  id uuid pk,
  sale_id uuid fk -> sales.id,
  product_id uuid fk -> products.id, nullable,  -- nullable por si se borra el producto
  product_name_snapshot text not null,          -- se copia el nombre al momento de la venta
  quantity numeric not null,
  unit_price numeric not null,
  subtotal numeric not null
)
```
Importante: **snapshot del nombre y precio al momento de la venta**. Si mañana cambiás el precio o borrás el producto, el historial de ventas no debe alterarse. Este es el mismo criterio que ya aplicás con `employee_id` nulleable en vez de borrar ventas.

`sales` se simplifica: deja de tener el texto de descripción y pasa a ser cabecera (total, cliente, empleado, métodos de pago, `cash_session_id`).

### 3.4 `stock_movements`
```sql
stock_movements (
  id uuid pk,
  store_id uuid fk -> stores.id,
  product_id uuid fk -> products.id,
  type text check (type in ('ingreso','venta','ajuste','merma')),
  quantity numeric not null,        -- positivo o negativo según type
  purchase_price numeric,           -- precio de compra de ESTE ingreso (opcional, ver 3.6)
  employee_id uuid fk -> profiles.id, nullable,
  note text,
  created_at timestamptz default now()
)
```
Cada venta genera automáticamente un movimiento tipo `venta` (vía trigger), así el `current_stock` de `products` siempre se recalcula de forma consistente y queda auditoría completa de por qué bajó o subió el stock.

### 3.5 `cash_sessions`
```sql
cash_sessions (
  id uuid pk,
  store_id uuid fk -> stores.id,
  employee_id uuid fk -> profiles.id,
  opened_at timestamptz default now(),
  closed_at timestamptz,
  opening_amount numeric not null,
  expected_amount numeric,     -- calculado al cerrar
  closing_amount numeric,      -- contado físicamente
  difference numeric,          -- closing - expected
  status text check (status in ('open','closed')) default 'open',
  notes text
)
```
`sales.cash_session_id` (FK, nullable solo para ventas históricas previas a este cambio).

### 3.6 Precio de compra — recomendación
Empezá simple: **campo `purchase_price` en `products`**, que se actualiza cada vez que cargás stock nuevo (el formulario de "cargar stock" pide cantidad + precio de compra opcional, y sobrescribe el campo). Es suficiente para calcular margen aproximado y para el análisis por categoría.

Si en el futuro el precio de compra varía mucho entre reposiciones y necesitás precisión contable real, migrás a costo promedio ponderado usando el histórico en `stock_movements.purchase_price`. No lo seedees ahora, es una fase 2 clara y aislada.

### 3.7 Permisos granulares (en vez de solo `role`)
```sql
-- agregar a profiles, o tabla separada employee_permissions
profiles.can_use_pos boolean default true
profiles.can_manage_stock boolean default true
```
- `role` sigue siendo `superadmin | admin | employee` y sigue controlando rutas grandes (middleware).
- Los flags controlan **funcionalidad dentro** del rol `employee`, para el rollout gradual que planeás (punto 6 de tu mensaje anterior).
- Hoy: admin activa ambos flags para todos. Mañana: admin desactiva `can_manage_stock` para el cajero nuevo, sin tocar código.

---

## 4. RLS — puntos a no olvidar
- Todas las tablas nuevas (`categories`, `products`, `sale_items`, `stock_movements`, `cash_sessions`) necesitan policies de `select/insert/update/delete` filtradas por `store_id = get_current_user_store_id()`, igual que las existentes.
- `sale_items` no tiene `store_id` directo — su policy debe hacer join contra `sales.store_id` (o denormalizar `store_id` en la tabla para simplificar la policy y el índice; recomendado por performance).
- Los triggers que generan `stock_movements` desde una venta deben correr con permisos suficientes (`security definer` si hace falta) pero sin romper el aislamiento — validá que el trigger use el `store_id` de la venta, no el del usuario que ejecuta.
- Revisar que `delete_employee_user()` siga funcionando igual (nullea `employee_id`, no borra ventas) y extenderlo para que tampoco rompa `cash_sessions` históricas del empleado eliminado.

---

## 5. Flujo de fases recomendado (para no volver loco a los agentes)

Cada fase es un **spec independiente** en gentle-ai/SDD: requisitos → diseño → tareas → implementación → revisión, antes de pasar a la siguiente. No arranques la fase N+1 sin haber cerrado y probado la fase N.

### Fase 0 — Preparación
- Backup de la base de datos actual (vía MCP de Supabase o dump manual).
- Confirmar entorno de staging/branch de Supabase para no migrar directo sobre producción.

### Fase 1 — Modelo de datos base
- Crear `categories`, `products`, `sale_items`, migrar datos existentes de `sales` (parsear el texto libre histórico a `sale_items` si es posible, o dejarlo como está y arrancar `sale_items` desde hoy).
- Actualizar `product_price_rules` para referenciar `product_id`.
- RLS de las tablas nuevas.
- **Entregable:** catálogo de productos funcional (CRUD básico), sin tocar todavía el POS.

### Fase 2 — Stock
- `stock_movements`, trigger de recálculo de `current_stock`.
- Vista de Stock: listado, carga rápida (ingreso), alertas visuales de `min_stock`.
- **Entregable:** módulo de stock independiente, funcional y probado.

### Fase 3 — Caja
- `cash_sessions`, lógica de apertura/cierre, cálculo de `expected_amount`.
- Bloqueo de ventas sin caja abierta.
- Widget de "Mi Caja" en sidebar (estado, efectivo, tiempo abierto).
- **Entregable:** apertura/cierre de caja funcionando de forma aislada (puede probarse sin el POS nuevo todavía, contra las ventas actuales).

### Fase 4 — Punto de Venta (POS) nuevo
- Refactor del `SalesForm` para usar `products` (búsqueda + escaneo con pistola) en vez de carga de texto libre.
- Generación de `sale_items` al confirmar venta.
- Acceso rápido a reposición de stock desde el propio buscador de productos.
- Atajos de teclado (buscar → agregar → cobrar).
- **Entregable:** flujo de venta completo end-to-end con el nuevo modelo.

### Fase 5 — Roles y permisos granulares
- Agregar `can_use_pos` / `can_manage_stock` a `profiles`.
- Actualizar middleware y UI de `UserManager` para togglear estos permisos.
- Vista de admin: caja + stock + analytics + alertas, todo unificado.
- **Entregable:** rollout gradual habilitado (activar/desactivar permisos por empleado).

### Fase 6 — Ticket, PDF y códigos de barra
- Rediseño de ticket (datos de tienda, vendedor, cliente, ítems, desglose por método de pago, aclaración "no es comprobante fiscal").
- Generación de código de barras por producto (biblioteca tipo `jsbarcode` o similar) e impresión individual/en lote.
- **Entregable:** ticket nuevo + impresión de etiquetas de código de barra.

### Fase 7 — Análisis con Chart.js
- Ventas por categoría, margen por producto/categoría (usando `purchase_price` vs `sale_price`), productos con baja rotación, comparativa por período.
- **Entregable:** módulo de análisis visual para admin.

### Fase 8 — Pulido y QA general
- Revisión de RLS end-to-end (probar con usuarios de distintas tiendas que no haya fugas de datos).
- Revisión de performance en Realtime con las tablas nuevas.
- Ajustes finales de UX en POS y Stock.

---

## 6. Consideraciones de UI/UX (resumen para consulta rápida durante el desarrollo)
- POS y Stock son **vistas separadas** en el sidebar, no mezcladas.
- POS optimizado para teclado/pistola primero, mouse segundo.
- Reposición rápida de stock **desde dentro del POS** cuando un producto tiene stock bajo o cero (modal chico, no navegar a otra pantalla).
- Sidebar agrupado por sección funcional (Operación / Catálogo / Personas / Análisis / Sistema), inspirado en la referencia analizada.
- Widget persistente de estado de caja abajo del sidebar.
- Alertas de stock bajo visibles tanto en la vista de Stock (fila resaltada) como en un contador accesible desde el dashboard.
- Categorías como entidad propia (no texto libre) para que el filtro de análisis sea confiable.

---

## 7. Prompt inicial para Claude Code (SDD / gentle-ai)

Copiá y pegá esto como primer mensaje en Claude Code. Está pensado para que el agente trabaje fase por fase, sin adelantarse, usando SDD y confirmando contigo en cada gate.

```
Contexto del proyecto:
Este es un ERP SaaS multi-tenant (Next.js 16 App Router + React 19 + TypeScript,
Tailwind v4 + Shadcn UI, Supabase/Postgres con RLS, Supabase Realtime, jsPDF para
tickets). Tengo el MCP de Supabase conectado, úsalo para inspeccionar el schema
real antes de proponer migraciones, y para aplicarlas cuando estén aprobadas.

Vamos a migrar el sistema de "registro de ventas con texto libre" a un sistema
completo de gestión de ventas y stock. Tengo un informe detallado con el modelo
de datos objetivo y el orden de fases recomendado (adjunto abajo). Quiero que
trabajes con SDD: para cada fase generá primero el spec (requisitos + diseño +
tareas), me lo mostrás, y solo después de que yo lo apruebe pasás a implementar
esa fase. No avances a la fase siguiente sin mi confirmación explícita.

Reglas importantes que no quiero que rompas:
- El aislamiento multi-tenant vía RLS (store_id = get_current_user_store_id())
  es innegociable. Cualquier tabla nueva necesita sus policies desde el día uno.
- El historial de ventas nunca se borra ni se corrompe. Si un producto o
  empleado se elimina, las ventas pasadas quedan intactas (igual criterio que
  ya usa delete_employee_user()).
- No quiero refactors grandes "de una". Cada fase debe ser chica, verificable,
  y no debe dejar el sistema en un estado roto a mitad de camino.
- Antes de tocar la base de datos en Supabase, inspeccioná el schema actual con
  el MCP y confirmame que tu propuesta de migración coincide con lo que hay
  realmente (no asumas nombres de columnas de memoria).
- Trabajá contra un branch/entorno de staging de Supabase si está disponible,
  nunca apliques migraciones directo a producción sin que yo lo pida.

Orden de fases (no te lo saltees, están en orden de dependencia):
1. Modelo de datos base: categories, products, sale_items (reemplaza el texto
   libre de sales), migración de product_price_rules para referenciar
   product_id, y RLS de todo lo nuevo.
2. Stock: tabla stock_movements, trigger de recálculo de current_stock, vista
   de Stock con carga rápida y alertas de stock bajo (min_stock).
3. Caja: tabla cash_sessions, apertura/cierre con cálculo de expected_amount
   vs closing_amount contado, bloqueo de ventas sin caja abierta, widget de
   estado de caja en el sidebar.
4. Punto de Venta nuevo: refactor del formulario de ventas para buscar/escanear
   productos reales (código de barra con pistola), generar sale_items, con
   acceso rápido a reposición de stock desde el mismo buscador si el stock
   está bajo o en cero, y atajos de teclado para agilizar el cobro.
5. Roles y permisos granulares: agregar can_use_pos y can_manage_stock a
   profiles (no cambiar el enum de role), actualizar middleware y el panel de
   gestión de personal para poder activar/desactivar estos permisos por
   empleado, para escalar gradualmente de "solo admin" a "admin + empleados
   habilitados".
6. Ticket, PDF y códigos de barra: rediseño del ticket con datos de tienda,
   vendedor, cliente, detalle de ítems, desglose por método de pago si es
   venta combinada, y aclaración de que no es comprobante fiscal. Generación
   e impresión de códigos de barra por producto.
7. Análisis con Chart.js: ventas por categoría, margen por producto/categoría
   usando purchase_price vs sale_price, productos de baja rotación,
   comparativas por período. Solo visible para admin.
8. QA general: verificar RLS entre tiendas distintas, revisar performance de
   Realtime con las tablas nuevas, pulir UX final de POS y Stock.

Empecemos por la Fase 1. Antes de escribir código: inspeccioná el schema
actual de Supabase vía MCP, y generame el spec de la Fase 1 (requisitos,
diseño de las tablas nuevas con sus RLS policies, y plan de migración de datos
existentes) para que lo revise antes de que implementes nada.
```

---

## 8. Notas finales
- Cada vez que termines una fase, pedile a Claude Code un resumen de "qué cambió en el schema" y "qué archivos se tocaron" antes de seguir — te sirve como changelog y como punto de rollback mental.
- Si en algún punto el agente propone tocar una tabla fuera del alcance de la fase actual, es señal de que se está adelantando: frenalo y pedile que lo deje anotado como tarea futura, no que lo haga ahora.
- Guardá este informe en el repo (por ejemplo en `/docs/migracion-stock-caja.md`) para que quede como fuente de verdad además de en los specs de SDD.