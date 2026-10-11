import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { ModulePage } from "./components/PageHeader";
import { DashboardPage } from "./pages/DashboardPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { MaterialsPage } from "./pages/MaterialsPage";
import { PurchasesPage } from "./pages/PurchasesPage";
import { UnitsPage } from "./pages/UnitsPage";
import { MassesPage } from "./pages/MassesPage";
import { RecipesPage } from "./pages/RecipesPage";
import { PlanningPage } from "./pages/PlanningPage";
import { ProductionsPage } from "./pages/ProductionsPage";
import { YieldsPage } from "./pages/YieldsPage";
import { ProductsPage } from "./pages/ProductsPage";
import { TransformationsPage } from "./pages/TransformationsPage";
import { SalesPage } from "./pages/SalesPage";
import { ExpensesPage } from "./pages/ExpensesPage";
import { ClosingsPage } from "./pages/ClosingsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { BackupPage } from "./pages/BackupPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />

          <Route path="/operaciones/compras" element={<PurchasesPage />} />
          <Route path="/operaciones/produccion" element={<ProductionsPage />} />
          <Route path="/operaciones/transformacion" element={<TransformationsPage />} />
          <Route
            path="/operaciones/ventas"
            element={<SalesPage />}
          />
          <Route path="/operaciones/cierre" element={<ClosingsPage />} />

          <Route path="/inventario/materias-primas" element={<MaterialsPage />} />
          <Route path="/inventario/masas" element={<MassesPage />} />
          <Route path="/inventario/productos" element={<ProductsPage />} />

          <Route path="/produccion/recetas" element={<RecipesPage />} />
          <Route path="/produccion/planes" element={<PlanningPage />} />
          <Route path="/produccion/producciones" element={<ProductionsPage />} />
          <Route path="/produccion/rendimientos" element={<YieldsPage />} />

          <Route
            path="/finanzas/ingresos"
            element={
              <ModulePage
                title="Ingresos"
                subtitle="Ventas y cobros por período"
                hint="los ingresos se registran en Operaciones → Ventas y se consolidan en el cierre diario."
              />
            }
          />
          <Route
            path="/finanzas/costos"
            element={
              <ModulePage
                title="Costos"
                subtitle="Costos de ventas y producción"
                hint="el costo de ventas aparece en el cierre diario y en Reportes → Rentabilidad."
              />
            }
          />
          <Route path="/finanzas/gastos" element={<ExpensesPage />} />
          <Route
            path="/finanzas/rentabilidad"
            element={
              <ModulePage
                title="Rentabilidad"
                subtitle="Utilidad, márgenes y evolución"
                hint="la rentabilidad del período está en Reportes → Rentabilidad."
              />
            }
          />

          <Route path="/reportes" element={<ReportsPage />} />
          <Route path="/configuracion/proveedores" element={<SuppliersPage />} />
          <Route path="/configuracion/unidades" element={<UnitsPage />} />
          <Route path="/configuracion/backup" element={<BackupPage />} />

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
