# PLAN DE DESARROLLO — NY SYSTEM

Sistema de gestión integral offline para empresa de producción de alimentos.
Este archivo es la **guía viva del proyecto**: cada tarea se marca ✅ al completarse.
Nunca saltar un hito sin cerrar el anterior. Regla de oro: cualquier cambio debe
verificarse contra Inventario · Costos · Producción · Ventas · Finanzas · Historial · Cierres · Auditoría.

---

## Decisiones de negocio cerradas

- [x] Moneda: **CUP**; dinero en **micro-CUP enteros** (1e-6, nunca float); cantidades en micro-unidades enteras; redondeo half-away-from-zero documentado en `shared/money.ts`.
- [x] Inventario **nunca negativo**: operaciones bloqueadas si stock insuficiente; solo ajustes motivados dejan negativo (auditados).
- [x] Valoración: **PEPS / FIFO con precio real** — cada compra crea un lote con el precio que se pagó; los consumos retiran primero el lote más antiguo. Sin promedios.
- [x] COGS: la venta **congela** `unit_price` y el `unit_cost` REAL del lote PEPS consumido en ese momento.
- [x] Inventario valorizado actual = **valor de los lotes restantes** + se muestra la última compra como referencia de reposición.
- [x] Mermas/daños: movimientos de inventario con motivo (Merma, Daño, Cierre, Otro).
- [x] Empaques: materiales en fase `paquete` de la receta, consumidos al **terminar**
  (transformación) por cada paquete REAL obtenido; la fase `masa` se consume al elaborar.
- [x] Ventas: solo mostrador, métodos de pago inmediatos. Sin crédito/clientes.
- [x] Sin ventas atrasadas: solo se venden días no cerrados con fecha = día en curso.
- [x] Cierre diario: el día cerrado es inmutable; reapertura con auditoría.
- [x] Recetas versionadas: producción apunta a la versión usada; nunca se edita una versión usada.
- [x] **Un solo usuario (admin)**: sin login, sin roles, sin permisos. Auditoría registra siempre "admin".
- [x] **Sin instalador**: primero corre local en navegador; Electron/instalador solo cuando el usuario lo pida.
- [x] Fechas: `business_date` (YYYY-MM-DD local) para operaciones; timestamps locales ISO.

---

## M1 — Base ✅ completado

- [x] Scaffold: Vite React TS + servidor Node TS, `npm run dev` levanta ambos (API :4545, UI :5173 con proxy).
- [x] SQLite + Drizzle: esquema completo (29 tablas) + migración inicial + seeds de unidades.
- [x] Driver propio Drizzle sobre **`node:sqlite`** (better-sqlite3 descartado: sin binario para Node 24 ni VS Build Tools); transacciones BEGIN/COMMIT/ROLLBACK + savepoints.
- [x] Módulo `Money`/`Quantity`: micro-enteros, conversiones por dimensión (bloqueo de conteo cruzado), redondeo half-away-from-zero.
- [x] Servidor local con API bajo `/api`, validación Zod y manejo centralado de errores (mensajes en español).
- [x] Layout: navegación lateral completa (Dashboard, Operaciones, Inventario, Producción, Finanzas, Reportes, Configuración).
- [x] Auditoría base (`audit_logs` + `logAudit`) + contadores de documentos (`doc_counters` + `nextDocNumber`).
- [x] Manejo de errores: español al usuario, detalle en log, rollback garantizado.
- [x] Verificado: migración, seeds, arranque, proxy y typecheck (server + client) en verde.

## M2 — Compras ✅ completado

- [x] CRUD proveedores.
- [x] CRUD materias primas (unidad base, categoría, stock mínimo, estado).
- [x] Registrar compra (items con precio unitario congelado, unidades compatibles).
- [x] Confirmar compra en transacción: stock+ → **crea lote FIFO con el precio real** → movimiento IN → auditoría.
- [x] Historial de compras y evolución de precios reales por materia prima.

## M3 — Producción de masas ✅ completado

- [x] CRUD recetas con versionado (nueva versión = registro nuevo; vigencia; archivar).
- [x] Producción: elegir versión de receta, cantidades, rendimiento esperado/real.
- [x] Confirmar en transacción: valida stock → consume MP (+empaques) → movimientos OUT →
      calcula costo total (suma de consumos a precio real de lote) → crea/aumenta masa (lote FIFO con ese costo) → movimientos IN → desviación de rendimiento.
- [x] Inventario de masas: stock, movimientos, valorización.
- [x] Smoke M3: 47/47 pass (costo 20 CUP → unit 2.50, versionado archiva, anulación revierte).

## M4 — Productos terminados ✅ completado

- [x] CRUD productos terminados (presentación, unidades por paquete, precio actual, stock mínimo).
- [x] Historial de precios de venta (`price_history`).
- [x] Transformación masa → productos: consume masa, genera PT, transfiere costo
      (proporcional a cantidad si genera varios productos).
- [x] Inventario de PT: stock, movimientos, valorización.
- [x] Smoke M4: 69/69 pass (reparto 16.666666/3.333334 sin fuga, anulación revierte).

## M5 — Ventas ✅ completado

- [x] Registrar venta (fecha = día en curso no cerrado): líneas con precio y costo congelados.
- [x] Descuentos, método de pago, anulación con trazabilidad (nunca borrado físico).
- [x] Stock− de PT + movimientos OUT en transacción.
- [x] Historial de ventas con precio realmente aplicado.
- [x] Smoke M5: 92/92 pass (precio libre ≠ actual, COGS PEPS, bloqueo de anulación de
      transformación con PT vendido).

## M6 — Gastos y cierre diario ✅ completado

- [x] CRUD gastos operativos (categoría, método de pago, responsable, anulación con motivo).
- [x] Cuadre de inventario: esperado vs físico por ítem con diferencia y motivo obligatorio
      (costo promedio por lote para valorizar la diferencia).
- [x] Cerrar día: ventas + COGS + gastos + utilidad; snapshot inmutable; auditoría.
- [x] Reapertura de día con auditoría (solo el último cierre, motivo obligatorio).
- [x] Frontend: ExpensesPage y ClosingsPage (hoja de conteo con diferencias en vivo).
- [x] Smoke M6: 128/128 pass (bloqueo de día cerrado, doble cierre 409, reapertura).
- [x] Fixes transversales detectados al probar la UI: `api/client` ahora desempaqueta el
      envelope `{ok,data}` (antes todas las páginas recibían el objeto completo) y
      `microToDecimal` corregido (solo funcionaba con 3 decimales; el dinero se mostraba mal).

## M7 — Dashboard, alertas y reportes ✅ completado

- [x] Dashboard: KPIs del día (ventas, costos, gastos, utilidad, margen, producción, stock).
- [x] Gráficos: serie de 14 días, productos más vendidos/rentables, ventas por método de pago.
- [x] Alertas: stock bajo/agotado, cierres pendientes, último cierre y diferencias.
- [x] Reportes: inventario, compras, producción, ventas, rentabilidad, auditoría.
- [x] Exportación CSV (BOM + escapado) y PDF vía impresión del navegador (`window.print`).
- Smoke: secciones 36–37 (`/api/dashboard`, `/api/reports/*`).

## M8 — Configuración, backup y demo ✅ completado

- [x] Configuración general (nombre del negocio, moneda CUP, bandera demo) — `app_settings`.
- [x] Backup manual + automático diario con retención (máx. 20) vía `VACUUM INTO`
      (copia consistente, nunca se lee de la BD "viva").
- [x] Restauración con validación (integridad + ≥20 tablas + semillas) y copia de seguridad
      `-safety-` previa; el servidor reabre la BD restaurada en caliente.
- [x] Seed/demo identificado claramente ("DEMO") de extremo a extremo: `npm run seed:demo`
      (día queda abierto; banner "Modo demo" en el layout).
- Smoke: sección 38 (settings, respaldo, restauración, validaciones).

## M9 — QA ✅ completado

- [x] Tests Vitest: dinero (`microToDecimal` half-away, `parseDecimalToMicro`, `mulQtyPrice`…),
      conversiones de unidades y rechazo de conteo cruzado.
- [x] Tests FIFO: lotes $1.50/$1.80 → consumo primero $1.50 (precio real, sin promedio),
      orden por fecha, stock insuficiente sin estado parcial.
- [x] Tests flujo: compra → stock+; producción → MP−, masa+; transformación → PT+;
      venta → PT−; precios y costos congelados históricos.
- [x] Tests: bloqueo de stock insuficiente y rollback transaccional.
- [x] Tests: cierre (esperado vs físico con motivo), inmutabilidad (409), reapertura auditada.
- [x] Recorrido E2E automatizado: smoke `data/api-smoke.mjs` — 171 aserciones en verde
      (Comprar → Producir → Transformar → Vender → Cuadrar → Cerrar → Rentabilidad →
      Config/Backup/Restaurar).
- Verificación final: typecheck cliente+servidor ✅ · smoke 171/171 ✅ · `npm test` 44/44 ✅.

## Posterior (solo si el usuario lo pide)

- [ ] Empaquetado Electron / instalador.

---

## Registro de cambios de plan

- 2026-10-09: Plan inicial. Simplificación: un solo usuario admin (sin auth ni permisos);
  primero navegador, Electron después; sin instalador hasta petición explícita.
- 2026-10-09: Cambio de valoración **promedio ponderado → PEPS/FIFO con precio real**
  (compras, consumos de producción, transformación y ventas). Inventario valorizado por
  lotes restantes + referencia de última compra.
- 2026-10-09: Driver de BD: better-sqlite3 descartado (sin binario Node 24 / sin VS) →
  driver Drizzle propio sobre `node:sqlite` nativo. Backup futuro con `VACUUM INTO`.
- 2026-10-09: **M1 completado** (scaffold, esquema 29 tablas, migración, unidades, dinero/
  unidades, layout, API base, auditoría y contadores).
- 2026-10-09: **M6 completado** (gastos + cierre diario con conteo físico y reapertura
  auditada). Corregidos dos bugs transversales: envelope `{ok,data}` sin desempaquetar en
  `src/api/client.ts` y `microToDecimal` erróneo en `shared/money.ts` (afectaba todo el
  dinero mostrado con 2 decimales).
- 2026-10-09: **M7 completado** (dashboard con KPIs/alertas/serie/top productos,
  reportes con 6 datasets + CSV BOM + impresión). Smoke 157/157.
- 2026-10-09: **M8 completado** (settings + backup `VACUUM INTO` con retención +
  restauración validada con copia `-safety-` + seed DEMO + banner demo + página de
  respaldos). Detalle: el chequeo de doble cierre (`ALREADY_CLOSED`) se movió ANTES de la
  validación de fecha en `closeDay` para dar el mensaje correcto. `import.meta.dirname`
  reemplazado por `fileURLToPath(import.meta.url)` (compatibilidad con Vitest).
  Smoke 171/171.
- 2026-10-09: **M9 completado** (Vitest: 44 pruebas en verde — dinero, unidades, PEPS/FIFO,
  flujo compra→producción→transformación→venta con precios/costos congelados, rollback,
  cierre/inmutabilidad/reapertura). Verificación final: typechecks ✅, smoke 171/171 ✅,
  `npm test` 44/44 ✅.
- 2026-10-09: **Modelo de recetas/producción/planificación reescrito** (spec NYORA §1–§14):
  una receta por producto (`recipes.productId` único) con ingredientes en fase `masa`/`paquete`
  y rendimiento en paquetes (unidad de venta); elaboración de N **masas completas** (enteras)
  con plan opcional, responsable y `clientToken` idempotente (esperado/real en masas);
  **planificación inversa** `/api/plans` (techo ceil, preview de materiales/faltantes/costos,
  nunca descuenta stock); **terminación** con paquetes reales vs esperados + desviación
  histórica, consumo de empaques sobre paquetes reales y costo congelado por receta; migración
  `0002` segura (columnas e índice único; datos existentes preservados); fix de escala
  `stockValueMicro`/`valor` (÷1e6) en dashboard y reportes. Verificación: tsc server+client ✅,
  Vitest **58/58** ✅, smoke **208/208** ✅, `vite build` ✅. UI alineada: RecipesPage (selector
  de producto, fases, rendimiento en paquetes), ProductionsPage (masas enteras, plan,
  responsable, idempotencia), TransformationsPage (receta, esperado/real/desviación, empaques),
  **PlanningPage** nueva + entrada "Planes" en el menú, Rendimientos con tabla de terminación
  (paquetes) y elaboración (masas vs plan), dashboard con KPI "Producción hoy"; limpieza de UI:
  entrada duplicada de Operaciones→Producción retirada, ModulePage sin "fase M7" (M7 cerrado)
  y con puntero a la pantalla equivalente, corrección de pérdida de datos al editar materiales
  (descripción) y masas/productos (stock mínimo), subtítulo de respaldos sin "datos de ejemplo".
