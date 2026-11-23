import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDbPool } from './db.js';
import { runExpirySweep } from './modules/jobs/expiry-worker.js';

async function main() {
  const config = loadConfig();
  const pool = createDbPool(config.databaseUrl);
  const app = await buildApp({ config, pool });

  const timer = setInterval(() => {
    runExpirySweep(pool).catch((err) => {
      app.log.error({ err }, 'Expiry sweep failed');
    });
  }, 15_000);
  timer.unref();

  const shutdown = async () => {
    clearInterval(timer);
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
