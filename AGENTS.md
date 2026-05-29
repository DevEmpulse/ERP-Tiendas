<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Contexto de la Aplicación 🏪

## Descripción General
Este es un ERP multi-inquilino (multi-tenant) para la administración de tiendas, donde múltiples tiendas están aisladas y cada una tiene su propio conjunto de administradores, empleados, clientes y ventas.

## Tecnologías Principales
- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript.
- **Estilos y Componentes**: Tailwind CSS v4 + Shadcn UI.
- **Base de Datos y Autenticación**: Supabase (PostgreSQL, Auth, RLS).

## Base de Datos (`migration.sql`)
1. **`stores`**: Tabla maestra de tiendas.
2. **`profiles`**: Perfiles de usuarios vinculados a `auth.users` y a una tienda. Roles: `admin` o `employee`.
3. **`clients`**: Clientes de cada tienda.
4. **`sales`**: Ventas de cada tienda.

### Políticas RLS y Triggers
- **Aislamiento**: RLS habilitado en todas las tablas; consultas filtradas automáticamente por `store_id` obtenido mediante `get_current_user_store_id()`.
- **Registro de Usuarios**: El trigger `on_auth_user_created` maneja el registro. Si el correo fue pre-cargado por un administrador, asocia el nuevo usuario al perfil existente; de lo contrario, crea una nueva tienda y asigna rol `admin`.
- **Pre-carga de Empleados**: La función `preload_employee()` permite a administradores pre-crear perfiles de empleados con correos específicos.

## Autenticación y Autorización (`src/proxy.ts`)
Control centralizado de rutas por roles:
- `/login`: Inicio de sesión mediante Google OAuth.
- `/admin/*`: Acceso exclusivo para usuarios con rol `admin`. Redirige a `/employee` si es un empleado.
- `/employee/*`: Acceso para `admin` y `employee`.
- `/`: Redirección automática al panel correspondiente según el rol tras iniciar sesión.
