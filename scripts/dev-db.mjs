// Local development database: real Postgres (PGlite) on 127.0.0.1:54329, data kept in .dev-db/.
// Run: npm run dev:db   then in .env.local:  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const db = await PGlite.create("./.dev-db");
const server = new PGLiteSocketServer({ db, port: 54329, host: "127.0.0.1", maxConnections: 20 });
await server.start();
console.log("Dev database ready on 127.0.0.1:54329 (data in .dev-db/)");
const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
