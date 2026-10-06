import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" throws outside a React Server Component bundle; tests run plain Node.
      "server-only": fileURLToPath(new URL("./tests/helpers/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    testTimeout: 20000,
    // Each file boots its own PGlite (Postgres compiled to WASM). Optimising that module with
    // TurboFan needs hundreds of MB per worker and crashes ("Fatal process out of memory: Zone")
    // on a machine with little free commit. Serial files + the Liftoff baseline compiler is
    // a few seconds slower and runs anywhere.
    fileParallelism: false,
    execArgv: ["--liftoff-only"],
  },
});
