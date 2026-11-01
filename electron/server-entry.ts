// Punto de entrada del servidor para Electron: crea la app Express con el UI
// compilado, abre la BD e inicia el listener local. Empaquetado por esbuild a
// un único CommonJS (dist-electron/server.cjs).
import http from "node:http";
import { createApp } from "../server/app";
import { closeDb, getDb } from "../server/db";
import { runAutoBackup } from "../server/services/backup";

const PORT = Number(process.env.PORT ?? 4545);
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export interface NyServerHandle {
  port: number;
  close: () => void;
}

export function startNyServer(): NyServerHandle {
  const handle = getDb(); // abre BD + migra + semillas
  const app = createApp();
  app.set("handle", handle);

  const server = http.createServer(app);
  // 127.0.0.1: la API solo es alcanzable desde la propia máquina (Electron).
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[ny-system] API local escuchando en http://127.0.0.1:${PORT}`);
    runAutoBackup(app.get("handle"));
  });

  // Comprueba el respaldo mensual aunque la app quede abierta al cambiar el mes.
  const timer = setInterval(() => {
    runAutoBackup(app.get("handle"));
  }, SIX_HOURS_MS);
  timer.unref?.();

  return {
    port: PORT,
    close: () => {
      clearInterval(timer);
      try {
        server.close();
      } catch {
        // ya cerrado
      }
      closeDb();
    },
  };
}

// Es ejecutado directamente (node electron/server.cjs) para depurar el modo
// empaquetado sin Electron: auto-arranca el servidor.
declare const require: NodeRequire;
if (typeof require !== "undefined" && require.main === module) {
  startNyServer();
}
