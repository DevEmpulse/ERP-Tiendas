# 💻 Guía del Desarrollador y Workflow SDD

Esta guía proporciona las instrucciones necesarias para configurar el entorno de desarrollo, ejecutar comandos de calidad de código y adherirse al flujo de trabajo **Gentle-AI / SDD (Spec-Driven Development)** de **ERP Tiendas**.

---

## 🛠️ Configuración del Entorno Local

### Requisitos Previos:
- **Node.js**: v18.18+ o v20+
- **Gestor de Paquetes**: `pnpm` (recomendado) o `npm`
- **Proyecto de Supabase**: Cuenta activa con proyecto Postgres y autenticación configurada.

### Pasos de Instalación:

1. **Clonar e instalar dependencias**:
   ```bash
   git clone <repository-url>
   cd ERP-Tiendas
   pnpm install
   ```

2. **Variables de Entorno (`.env.local`)**:
   Cree un archivo `.env.local` en la raíz del proyecto con las credenciales de su instancia de Supabase:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://<your-project-id>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
   ```

3. **Base de Datos**:
   Ejecute el contenido del archivo [`migration.sql`](file:///Users/matiasbhr/Dev/ERP-Tiendas/migration.sql) en el Editor SQL de su panel de Supabase para crear las tablas, funciones RLS, triggers y procedimientos almacenados.

4. **Iniciar Servidor de Desarrollo**:
   ```bash
   pnpm run dev
   ```
   Abra [http://localhost:3000](http://localhost:3000) en el navegador.

---

## 🤖 Workflow Gentle-AI & SDD (Spec-Driven Development)

El proyecto utiliza la metodología SDD respaldada por el ecosistema Gentle-AI para mantener especificaciones vivas en el repositorio:

- **Estructura SDD**: Ubicada en la carpeta `.sdd/`:
  - `.sdd/config.json`: Define el stack del proyecto (Next.js 16, React 19, Tailwind v4, Supabase Auth/RLS).
  - `.sdd/index.md`: Registro central de especificaciones de diseño y requisitos del sistema.
- **Reglas de Agente (`AGENTS.md`)**: Define los principios de arquitectura, patrones de seguridad RLS e instrucciones para modelos de IA en el proyecto.

---

## 📐 Convenciones de Código y Calidad

Para garantizar un código mantenible y libre de errores:

### 1. Reglas de React 19 & Compiler (`react-hooks/*`)
- **Puresa en Renderizado**: No invoque `Math.random()`, `Date.now()` o `setState` de manera síncrona dentro del cuerpo del componente o de hooks durante el renderizado.
- **Carga de Datos en Efectos**: Utilice el patrón de bandera de cancelación para prevenir condiciones de carrera y re-renderizados en cascada:
  ```tsx
  useEffect(() => {
    let ignore = false
    async function fetchData() {
      const { data } = await supabase.from('table').select('*')
      if (!ignore) setState(data)
    }
    fetchData()
    return () => { ignore = true }
  }, [supabase])
  ```
- **Sin Componentes Anidados**: Nunca declare componentes funcionales dentro del cuerpo de renderizado de otro componente; extraiga sub-vistas a variables JSX o componentes independientes.

### 2. Estricta Verificación de Tipos (TypeScript)
- Queda **estrictamente prohibido** el uso de `any`.
- Defina tipos e interfaces claros en `@/lib/salesHelper` o en la cabecera de los archivos de componentes.
- Utilice `Record<string, unknown>` o `unknown` para capturar errores de bloque `catch (err: unknown)`.

---

## 🧪 Comandos de Verificación

Ejecute los siguientes comandos antes de enviar cambios al repositorio:

```bash
# 1. Ejecutar linter (debe terminar con 0 errores y 0 advertencias)
pnpm run lint

# 2. Compilar producción y verificar chequeo de tipos TypeScript
pnpm run build
```

---

## 📋 Checklist de Calidad
- [x] RLS habilitado y verificado en todas las tablas con `store_id`.
- [x] Sin advertencias ni errores en `pnpm run lint`.
- [x] `pnpm run build` compila con éxito en 0 errores de tipos.
- [x] Documentación actualizada en la carpeta `docs/`.
