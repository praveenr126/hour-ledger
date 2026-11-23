import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import type { Pool } from 'pg';
import type { AppConfig } from './config.js';
import { createDbPool } from './db.js';
import { MockOtpSender, type OtpSender } from './modules/auth/otp-sender.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerProfileRoutes } from './modules/profile/routes.js';
import { registerWalletRoutes } from './modules/wallet/routes.js';
import { registerJobRoutes } from './modules/jobs/routes.js';
import { registerShiftRoutes } from './modules/shifts/routes.js';
import { registerRatingRoutes } from './modules/ratings/routes.js';

export interface BuildAppOptions {
  config: AppConfig;
  pool?: Pool;
  otpSender?: OtpSender;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, logger = true } = options;
  const ownsPool = !options.pool;
  const pool = options.pool ?? createDbPool(config.databaseUrl);
  const otpSender = options.otpSender ?? new MockOtpSender();

  const app = Fastify({ logger });

  await app.register(fastifyJwt, {
    secret: config.jwtSecret
  });

  app.setErrorHandler((err, _req, reply) => {
    const e = err as { validation?: unknown; message?: string; statusCode?: number };
    if (e?.validation) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: e.message ?? 'Invalid request'
      });
    }
    app.log.error(err);
    return reply.code(typeof e?.statusCode === 'number' ? e.statusCode : 500).send({
      error: 'INTERNAL_ERROR',
      message: 'Unexpected server error'
    });
  });

  await app.register(
    async (v1) => {
      v1.get('/health', async (_req, reply) => {
        const res = await pool.query<{ now: Date }>('SELECT now() AS now');
        return reply.code(200).send({
          status: 'ok',
          db: 'up',
          server_time_utc: res.rows[0].now.toISOString()
        });
      });

      await registerAuthRoutes(v1, { pool, config, otpSender });
      await registerProfileRoutes(v1, { pool, config });
      await registerWalletRoutes(v1, { pool });
      await registerJobRoutes(v1, { pool });
      await registerShiftRoutes(v1, { pool, config });
      await registerRatingRoutes(v1, { pool });
    },
    { prefix: '/v1' }
  );

  app.addHook('onClose', async () => {
    if (ownsPool) {
      await pool.end();
    }
  });

  return app;
}
