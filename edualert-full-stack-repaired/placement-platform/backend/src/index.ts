import { env } from './config/env.js';
import { prisma } from './db.js';
import { buildApp } from './app.js';
import { scheduleRiskScoring } from './services/risk-scoring.js';

async function main() {
  const app = await buildApp({ prisma });

  // Fail fast and loudly if the database is unreachable at boot instead of 500-ing every request.
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    app.log.error({ err }, 'Cannot connect to PostgreSQL. Check DATABASE_URL and that the database is running and migrated.');
    process.exit(1);
  }

  const cron = scheduleRiskScoring(prisma);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    cron.stop();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
