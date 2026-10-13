import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
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
import { IngresosPage } from "./pages/IngresosPage";
import { CostosPage } from "./pages/CostosPage";
import { ExpensesPage } from "./pages/ExpensesPage";
import { ProfitabilityPage } from "./pages/ProfitabilityPage";
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

          <Route path="/finanzas/ingresos" element={<IngresosPage />} />
          <Route path="/finanzas/costos" element={<CostosPage />} />
          <Route path="/finanzas/gastos" element={<ExpensesPage />} />
          <Route path="/finanzas/rentabilidad" element={<ProfitabilityPage />} />

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
