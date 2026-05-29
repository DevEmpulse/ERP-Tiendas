import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ERP Tiendas",
    short_name: "ERP Tiendas",
    description: "Sistema de administración de tiendas — gestión de ventas, clientes y empleados",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f0a1e",
    theme_color: "#1e1b4b",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "Panel Admin",
        short_name: "Admin",
        description: "Acceder al panel de administrador",
        url: "/admin",
        icons: [{ src: "/icon-192x192.png", sizes: "192x192" }],
      },
      {
        name: "Registrar Venta",
        short_name: "Venta",
        description: "Registrar una nueva venta",
        url: "/employee",
        icons: [{ src: "/icon-192x192.png", sizes: "192x192" }],
      },
    ],
  };
}
