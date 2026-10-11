import { createApp } from "./app";
import { getDb } from "./db";
import { runAutoBackup } from "./services/backup";

const PORT = Number(process.env.PORT ?? 4545);

function main(): void {
  const handle = getDb(); // abre BD + migra + semillas
  const app = createApp();

  app.set("handle", handle);

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`[ny-system] API local escuchando en http://127.0.0.1:${PORT}`);
    console.log(`[ny-system] BD: SQLite con migraciones aplicadas.`);
    runAutoBackup(handle);
  });
}

main();
