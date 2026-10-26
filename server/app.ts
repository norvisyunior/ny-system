import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { ZodError } from "zod";
import { AppError, isAppError } from "./domain/errors";
import { suppliersRouter } from "./routes/suppliers";
import { materialsRouter } from "./routes/materials";
import { purchasesRouter } from "./routes/purchases";
import { unitsRouter } from "./routes/units";
import { massesRouter } from "./routes/masses";
import { recipesRouter, recipeVersionsRouter } from "./routes/recipes";
import { productionsRouter } from "./routes/productions";
import { plansRouter } from "./routes/plans";
import { costSheetsRouter } from "./routes/costsheets";
import { laborRatesRouter } from "./routes/laborrates";
import { productsRouter } from "./routes/products";
import { transformationsRouter } from "./routes/transformations";
import { salesRouter } from "./routes/sales";
import { expensesRouter } from "./routes/expenses";
import { closingsRouter } from "./routes/closings";
import { dashboardRouter } from "./routes/dashboard";
import { reportsRouter } from "./routes/reports";
import { settingsRouter } from "./routes/settings";
import { backupsRouter } from "./routes/backups";

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, app: "ny-system", time: new Date().toISOString() });
  });

  // registrar rutas de módulos aquí:
  registerRoutes(app);

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: "Ruta no encontrada." });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const { status, payload } = normalizeError(err);
    if (status >= 500) {
      console.error("[ERROR]", err);
    }
    res.status(status).json({ ok: false, ...payload });
  });

  return app;
}

function normalizeError(err: unknown): {
  status: number;
  payload: { error: string; code?: string; details?: unknown };
} {
  if (err instanceof ZodError) {
    return {
      status: 400,
      payload: {
        error: formatZodError(err),
        code: "VALIDATION_ERROR",
        details: err.flatten(),
      },
    };
  }
  if (isAppError(err)) {
    const e = err as AppError;
    return { status: e.status, payload: { error: e.userMessage, code: e.code, details: e.details } };
  }
  const maybeUserFacing = err as { userFacing?: boolean; message?: string };
  if (maybeUserFacing?.userFacing && typeof maybeUserFacing.message === "string") {
    return { status: 400, payload: { error: maybeUserFacing.message, code: "DOMAIN_ERROR" } };
  }
  return {
    status: 500,
    payload: {
      error: "Ocurrió un error inesperado. Revise el log técnico de la aplicación.",
      code: "INTERNAL_ERROR",
    },
  };
}

function formatZodError(err: ZodError): string {
  const issues = err.issues.map((i) => {
    const field = i.path.length > 0 ? `${i.path.join(".")}: ` : "";
    return field + i.message;
  });
  return `Datos inválidos — ${issues.join(" | ")}`;
}

function registerRoutes(app: express.Express): void {
  app.use("/api/suppliers", suppliersRouter);
  app.use("/api/materials", materialsRouter);
  app.use("/api/purchases", purchasesRouter);
  app.use("/api/units", unitsRouter);
  app.use("/api/masses", massesRouter);
  app.use("/api/recipes", recipesRouter);
  app.use("/api/recipe-versions", recipeVersionsRouter);
  app.use("/api/productions", productionsRouter);
  app.use("/api/plans", plansRouter);
  app.use("/api/cost-sheets", costSheetsRouter);
  app.use("/api/labor-rates", laborRatesRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/transformations", transformationsRouter);
  app.use("/api/sales", salesRouter);
  app.use("/api/expenses", expensesRouter);
  app.use("/api/closings", closingsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/backups", backupsRouter);
}
