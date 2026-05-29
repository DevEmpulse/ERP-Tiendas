# ERP-Tiendas 🏪

Un sistema ERP multi-inquilino (multi-tenant) moderno diseñado para la gestión y administración de tiendas. Permite a los dueños de tiendas (Admins) y a sus empleados (Employees) gestionar ventas, clientes y configuraciones de forma segura, aislada y eficiente.

---

## 🚀 Arquitectura y Tecnologías Principal

El proyecto está construido sobre el siguiente stack tecnológico:

- **Frontend**: [Next.js 16](https://nextjs.org/) (App Router), con [React 19](https://react.dev/) y [TypeScript](https://www.typescriptlang.org/).
- **Estilos**: [Tailwind CSS v4](https://tailwindcss.com/) y componentes visuales basados en [Shadcn UI](https://ui.shadcn.com/) (Card, Button, Dialog, Table, Input, etc.).
- **Base de Datos y Auth**: [Supabase](https://supabase.com/) (PostgreSQL, Auth nativo con OAuth de Google, y políticas RLS avanzadas).
- **Gestor de Paquetes**: [pnpm](https://pnpm.io/).

---

## 🗄️ Modelo de Base de Datos y Seguridad (RLS)

La base de datos cuenta con aislamiento multi-tenant mediante políticas de **Row Level Security (RLS)** de Postgres. Toda la información de una tienda está protegida para que solo los miembros de esa misma tienda puedan verla o modificarla.

### Tablas Principales (`migration.sql`)

1. **`stores`**: Registra las tiendas del sistema.
   - `id` (UUID, PK)
   - `name` (text)
   - `created_at` (timestamptz)

2. **`profiles`**: Almacena los perfiles de usuario, vinculados a la autenticación de Supabase (`auth.users`) y a una tienda en particular.
   - `id` (UUID, PK, FK a `auth.users`)
   - `store_id` (UUID, FK a `stores`)
   - `email` (text, unique)
   - `name` (text)
   - `role` (text: `'admin'` o `'employee'`)
   - `created_at` (timestamptz)

3. **`clients`**: Clientes registrados en cada tienda.
   - `id` (UUID, PK)
   - `store_id` (UUID, FK a `stores`)
   - `name` (text)
   - `phone` (text)
   - `created_at` (timestamptz)

4. **`sales`**: Registro de ventas/transacciones ejecutadas.
   - `id` (UUID, PK)
   - `store_id` (UUID, FK a `stores`)
   - `employee_id` (UUID, FK a `profiles`)
   - `description` (text)
   - `payment_method` (text: `'cash'`, `'transfer'`, o `'card'`)
   - `total_amount` (numeric)
   - `client_id` (UUID, FK a `clients`, opcional)
   - `created_at` (timestamptz)

### Funciones y Triggers Clave

- **`get_current_user_store_id()` y `get_current_user_role()`**: Funciones auxiliares de Postgres para obtener dinámicamente el `store_id` y `role` del usuario autenticado actual y aplicar políticas RLS de forma automática.
- **Trigger `on_auth_user_created` (`handle_new_user()`)**:
  - Si un nuevo usuario se registra y su correo **ya fue pre-cargado** por un administrador, el trigger vincula su cuenta de autenticación al perfil existente.
  - Si es un **registro nuevo de propietario (Owner)**, crea automáticamente una nueva tienda (`stores`) y le asigna un perfil con rol de `'admin'`.
- **`preload_employee()`**: Función almacenada que permite únicamente a los administradores pre-cargar empleados en su tienda generando un perfil/usuario ficticio que luego se activa cuando el empleado se registra con su cuenta de Google/correo.

---

## 🔐 Flujo de Autenticación y Autorización

La autenticación principal se realiza mediante **OAuth con Google**.

### Redirección y Control de Acceso (`src/proxy.ts` / Middleware)
El archivo `src/proxy.ts` maneja la verificación de sesión y redirecciones automáticas basadas en roles:
1. **Usuarios No Autenticados**: Son redirigidos automáticamente a `/login` si intentan acceder a la raíz `/` o rutas protegidas (`/admin/*`, `/employee/*`).
2. **Rol Admin**: Redirigido a `/admin` al iniciar sesión o acceder a `/`. Tiene acceso a todas las secciones.
3. **Rol Employee**: Redirigido a `/employee` al iniciar sesión o acceder a `/`. Si intenta acceder a `/admin/*`, es re-direccionado a su portal `/employee`.

---

## 📂 Estructura de Directorios Principal

```bash
├── .agents/               # Configuración y skills de agentes de desarrollo
├── src/
│   ├── app/               # Enrutamiento de Next.js (App Router)
│   │   ├── admin/         # Panel de control del Administrador (Dashboard)
│   │   ├── employee/      # Portal de ventas para Empleados
│   │   ├── login/         # Página de login (OAuth Google)
│   │   ├── auth/callback/ # Endpoint de callback de OAuth de Supabase
│   │   ├── layout.tsx     # Layout global
│   │   └── page.tsx       # Redirección raíz
│   ├── components/
│   │   └── ui/            # Componentes reutilizables de Shadcn UI
│   ├── lib/
│   │   └── utils.ts       # Utilidades globales (clsx, tailwind-merge)
│   ├── utils/
│   │   └── supabase/      # Utilidades de inicialización de Supabase
│   │       ├── client.ts  # Cliente de navegador (Client Component)
│   │       ├── server.ts  # Cliente de servidor (Server Component / Server Actions)
│   │       └── middleware.ts # Manejo de actualización de tokens de sesión
│   └── proxy.ts           # Lógica centralizada de autorización y redirección por roles
├── migration.sql          # Script SQL con el esquema de base de datos y políticas de Supabase
├── package.json           # Dependencias y scripts de desarrollo
└── tsconfig.json          # Configuración de TypeScript
```

---

## 💻 Desarrollo Local

1. **Variables de Entorno**: Crea un archivo `.env.local` en la raíz con las credenciales de Supabase:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=tu_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_supabase_anon_key
   ```
2. **Instalar dependencias**:
   ```bash
   pnpm install
   ```
3. **Ejecutar servidor de desarrollo**:
   ```bash
   pnpm dev
   ```
4. **Abrir aplicación**: Accede a [http://localhost:3000](http://localhost:3000).
