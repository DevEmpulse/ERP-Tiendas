# 🏪 ERP Tiendas — Documentación General

Bienvenido a la documentación oficial de **ERP Tiendas**, un sistema ERP (Enterprise Resource Planning) multi-inquilino (*multi-tenant*) de alto rendimiento diseñado para la administración integral de comercios y tiendas.

---

## 📌 Tabla de Contenidos
1. [Visión General](#visión-general)
2. [Stack Tecnológico](#stack-tecnológico)
3. [Estructura del Proyecto](#estructura-del-proyecto)
4. [Documentos de Referencia](#documentos-de-referencia)

---

## 🚀 Visión General
**ERP Tiendas** permite aislar de manera segura la información de múltiples comercios. Cada tienda opera dentro de su propio entorno aislado con:
- **Aislamiento Multi-inquilino**: Garantizado a nivel de base de datos mediante Supabase Row Level Security (RLS).
- **Jerarquía de Roles**: `superadmin`, `admin` y `employee`.
- **Gestión de Ventas**: Registro individual o combinado (Efectivo, Transferencia, Tarjeta), agrupación automática de transacciones y cálculo de métricas en tiempo real.
- **Impresión de Tickets**: Generación dinámica de comprobantes térmicos configurables (58mm / 80mm) e integración para descarga en PDF (`jsPDF`).
- **Gestión de Precios Especiales & Stock**: Reglas de precios automáticos por cantidad/volumen (p. ej., docena/mayorista).
- **Directorio de Clientes**: Registro rápido con vinculación opcional de teléfono a las ventas.

---

## 🛠️ Stack Tecnológico

| Capa | Tecnología | Descripción |
| :--- | :--- | :--- |
| **Framework Web** | Next.js 16 (App Router) | Renderizado optimizado, React 19 y Server Actions / Proxy |
| **UI & Estilos** | Tailwind CSS v4 + Shadcn UI | Interfaz limpia, responsiva y modo oscuro nativo |
| **Base de Datos** | Supabase PostgreSQL | Tablas relacionales con RLS y triggers PL/pgSQL |
| **Autenticación** | Supabase Auth | Autenticación con Google OAuth y control centralizado |
| **Lenguaje** | TypeScript | Tipado estricto en todo el codebase |
| **Metodología** | Gentle-AI & SDD | Desarrollo guiado por especificaciones (Spec-Driven Development) |

---

## 📁 Estructura del Proyecto

```text
ERP-Tiendas/
├── .sdd/                      # Especificaciones y configuración del workflow SDD
├── docs/                      # Documentación del proyecto (esta carpeta)
├── migration.sql              # Esquema SQL máster (Tablas, RLS, Triggers, Funciones)
├── src/
│   ├── app/                   # Rutas App Router (/admin, /employee, /superadmin, /login)
│   ├── components/
│   │   ├── admin/             # Paneles y componentes exclusivos de Administrador
│   │   ├── employee/          # Formularios y vistas de Empleados
│   │   ├── shared/            # Componentes compartidos (ReceiptModal, etc.)
│   │   ├── ui/                # Sistema de componentes Shadcn UI
│   │   └── pwa/               # PWA y Service Worker
│   ├── lib/                   # Helpers (salesHelper, pdfGenerator, utils)
│   ├── utils/supabase/        # Clientes de Supabase (client, server, middleware)
│   └── proxy.ts               # Control centralizado de autorización y redirección de rutas
```

---

## 📚 Documentos de Referencia

Explore la documentación detallada dividida por áreas clave:

- 🏗️ **[Arquitectura del Sistema](file:///Users/matiasbhr/Dev/ERP-Tiendas/docs/architecture.md)**: Flujo de datos, aislamiento multi-tenant, proxy y middleware.
- 🗄️ **[Base de Datos y Seguridad (RLS)](file:///Users/matiasbhr/Dev/ERP-Tiendas/docs/database.md)**: Tablas, funciones PL/pgSQL, triggers y políticas RLS.
- 🔑 **[Autenticación y Roles](file:///Users/matiasbhr/Dev/ERP-Tiendas/docs/authentication-and-roles.md)**: OAuth, pre-registro de empleados, lista blanca de administradores y control de acceso.
- ✨ **[Funcionalidades y Módulos](file:///Users/matiasbhr/Dev/ERP-Tiendas/docs/features.md)**: Registro de ventas combinadas, stock/precios, clientes, reportes y tickets.
- 💻 **[Guía del Desarrollador y SDD](file:///Users/matiasbhr/Dev/ERP-Tiendas/docs/developer-guide.md)**: Setup, comandos, convenciones de código y checklist de calidad.
