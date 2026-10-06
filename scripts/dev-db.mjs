// Local development database: real Postgres (PGlite) on 127.0.0.1:54329, data kept in .dev-db/.
// Run: npm run dev:db   then in .env.local:  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres
// A second, independent database (e.g. for screenshots while tests run): DEV_DB_PORT=54330 DEV_DB_DIR=.dev-db-2 npm run dev:db
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number(process.env.DEV_DB_PORT ?? 54329);
const dir = process.env.DEV_DB_DIR ?? ".dev-db";
const db = await PGlite.create(`./${dir}`);
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 20 });
await server.start();
console.log(`Dev database ready on 127.0.0.1:${port} (data in ${dir}/)`);
const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
