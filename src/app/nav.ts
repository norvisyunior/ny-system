export interface NavItem {
  label: string;
  path: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { label: "", items: [{ label: "Dashboard", path: "/dashboard" }] },
  {
    label: "Operaciones",
    items: [
      { label: "Compras", path: "/operaciones/compras" },
      { label: "Transformación", path: "/operaciones/transformacion" },
      { label: "Ventas", path: "/operaciones/ventas" },
      { label: "Cierre diario", path: "/operaciones/cierre" },
    ],
  },
  {
    label: "Inventario",
    items: [
      { label: "Materias primas", path: "/inventario/materias-primas" },
      { label: "Masas", path: "/inventario/masas" },
      { label: "Productos terminados", path: "/inventario/productos" },
    ],
  },
  {
    label: "Producción",
    items: [
      { label: "Recetas", path: "/produccion/recetas" },
      { label: "Planes", path: "/produccion/planes" },
      { label: "Producciones", path: "/produccion/producciones" },
      { label: "Rendimientos", path: "/produccion/rendimientos" },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { label: "Ingresos", path: "/finanzas/ingresos" },
      { label: "Costos", path: "/finanzas/costos" },
      { label: "Gastos", path: "/finanzas/gastos" },
      { label: "Rentabilidad", path: "/finanzas/rentabilidad" },
    ],
  },
  { label: "Reportes", items: [{ label: "Reportes", path: "/reportes" }] },
  {
    label: "Configuración",
    items: [
      { label: "Proveedores", path: "/configuracion/proveedores" },
      { label: "Unidades", path: "/configuracion/unidades" },
      { label: "Backup", path: "/configuracion/backup" },
    ],
  },
];
