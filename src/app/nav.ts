import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Calculator,
  CalendarCheck,
  ChartColumn,
  ClipboardList,
  Cookie,
  DollarSign,
  Factory,
  Gauge,
  Home,
  PackageCheck,
  Percent,
  Receipt,
  Repeat,
  Ruler,
  Save,
  ShoppingCart,
  TrendingUp,
  Truck,
  Wallet,
  Wheat,
} from "lucide-react";

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { label: "", items: [{ label: "Dashboard", path: "/dashboard", icon: Home }] },
  {
    label: "Operaciones",
    items: [
      { label: "Compras", path: "/operaciones/compras", icon: ShoppingCart },
      { label: "Empaquetado", path: "/operaciones/transformacion", icon: Repeat },
      { label: "Ventas", path: "/operaciones/ventas", icon: Receipt },
      { label: "Cierre diario", path: "/operaciones/cierre", icon: CalendarCheck },
    ],
  },
  {
    label: "Inventario",
    items: [
      { label: "Materias primas", path: "/inventario/materias-primas", icon: Wheat },
      { label: "Masas", path: "/inventario/masas", icon: Cookie },
      { label: "Productos terminados", path: "/inventario/productos", icon: PackageCheck },
    ],
  },
  {
    label: "Producción",
    items: [
      { label: "Recetas", path: "/produccion/recetas", icon: BookOpen },
      { label: "Fichas de costo", path: "/produccion/fichas-costo", icon: Calculator },
      { label: "Planes", path: "/produccion/planes", icon: ClipboardList },
      { label: "Producciones", path: "/produccion/producciones", icon: Factory },
      { label: "Rendimientos", path: "/produccion/rendimientos", icon: Gauge },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { label: "Ingresos", path: "/finanzas/ingresos", icon: TrendingUp },
      { label: "Costos", path: "/finanzas/costos", icon: DollarSign },
      { label: "Gastos", path: "/finanzas/gastos", icon: Wallet },
      { label: "Rentabilidad", path: "/finanzas/rentabilidad", icon: Percent },
    ],
  },
  { label: "Reportes", items: [{ label: "Reportes", path: "/reportes", icon: ChartColumn }] },
  {
    label: "Configuración",
    items: [
      { label: "Proveedores", path: "/configuracion/proveedores", icon: Truck },
      { label: "Unidades", path: "/configuracion/unidades", icon: Ruler },
      { label: "Backup", path: "/configuracion/backup", icon: Save },
    ],
  },
];
