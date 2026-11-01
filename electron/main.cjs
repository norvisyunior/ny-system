// Proceso main de Electron para NY-SYSTEM.
// - Dev (NY_SYSTEM_DEV=1): ventana que carga Vite (localhost:5173).
//   El API y la UI ya corren por "npm run dev" (tsx + vite).
// - Empaquetado: fija las rutas de datos en el perfil del usuario, arranca el
//   servidor embebido (dist-electron/server.cjs) y muestra el UI compilado
//   servido por el propio Express en 127.0.0.1.
const { app, BrowserWindow, shell, session } = require("electron");
const { join } = require("node:path");
const http = require("node:http");
const fs = require("node:fs");

const DEV = process.env.NY_SYSTEM_DEV === "1";
const PORT = Number(process.env.PORT ?? 4545);
const URL_UI = DEV ? "http://localhost:5173" : `http://127.0.0.1:${PORT}`;

let mainWin = null;
let serverHandle = null;
let quitting = false;

// Asegura una sola instancia (una sola BD viva; el API no compite por el puerto).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });
}

function iconPath() {
  try {
    const p = join(__dirname, "..", "build", "icon.ico");
    if (fs.existsSync(p)) return p;
  } catch {
    // sin icono local
  }
  return undefined;
}

/** Espera a que el API local responda antes de cargar la ventana. */
function waitForServer(url, tries = 60, delayMs = 250) {
  return new Promise((resolve) => {
    const attempt = (left) => {
      const req = http.get(`${url}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        retry(left);
      });
      req.on("error", () => retry(left));
      function retry(l) {
        if (l <= 0) return resolve(false);
        setTimeout(() => attempt(l - 1), delayMs);
      }
    };
    attempt(tries);
  });
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    title: "NYORA — NY-SYSTEM",
    icon: iconPath(),
    show: false,
    backgroundColor: "#f2f5fb",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWin.once("ready-to-show", () => mainWin.show());
  mainWin.setMenuBarVisibility(false);

  // Los enlaces externos abren el navegador del sistema, no una ventana nueva.
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(URL_UI)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWin.loadURL(URL_UI);
}

// Descargas (CSV de reportes, respaldos): sin diálogo, a la carpeta de
// descargas del usuario con nombre único.
function setupDownloads() {
  session.defaultSession.on("will-download", (_event, item) => {
    try {
      const dir = app.getPath("downloads");
      const base = item.getFilename().replace(/[\\/:*?"<>|]/g, "_");
      let path = join(dir, base);
      let i = 1;
      while (fs.existsSync(path)) {
        const ext = path.lastIndexOf(".");
        const stem = ext > -1 ? path.slice(0, ext) : path;
        const tail = ext > -1 ? path.slice(ext) : "";
        path = `${stem} (${i++})${tail}`;
      }
      item.setSavePath(path);
    } catch {
      // permite el comportamiento por defecto si falla la carpeta
    }
  });
}

app.whenReady().then(async () => {
  if (!DEV) {
    // Rutas de datos bajo el perfil del usuario (sobreviven actualizaciones).
    const dataRoot = join(app.getPath("userData"), "data");
    process.env.NY_SYSTEM_DB_PATH = join(dataRoot, "ny-system.db");
    process.env.NY_SYSTEM_BACKUP_DIR = join(dataRoot, "backups");
    process.env.NY_SYSTEM_MIGRATIONS_DIR = join(process.resourcesPath, "drizzle");
    process.env.NY_SYSTEM_STATIC_DIR = join(__dirname, "..", "dist");

    // El server bundle ya fue compilado a CJS por esbuild (scripts build-electron).
    // Se requiere aquí para que las variables de entorno estén fijadas antes.
    serverHandle = require(join(__dirname, "server.cjs")).startNyServer();
    setupDownloads();
    await waitForServer(`http://127.0.0.1:${PORT}`);
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  if (quitting) return;
  quitting = true;
  try {
    serverHandle && serverHandle.close();
  } catch {
    // cierre tolerant: el proceso termina igualmente
  }
});
