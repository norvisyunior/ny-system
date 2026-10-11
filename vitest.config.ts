import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Las pruebas abren SQLite en memoria; se ejecutan en serie para evitar
    // interferencias entre archivos (misma BD lógica, distintas conexiones).
    fileParallelism: false,
  },
});
