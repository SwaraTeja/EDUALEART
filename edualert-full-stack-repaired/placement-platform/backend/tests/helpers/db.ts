import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import type { PrismaClient } from '@prisma/client';

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!;

/**
 * Creates the Prisma client used by the tests.
 *  - default (TEST_PRISMA_MODE unset): the normal generated `@prisma/client` (needs `npx prisma generate`).
 *  - TEST_PRISMA_MODE=wasm: a client built on Prisma's bundled WebAssembly engine + the `pg` driver adapter.
 *    This exists only for sandboxes that cannot download Prisma's native engine; see tests/sandbox/README.md.
 *    Application code and SQL are identical in both modes.
 */
export async function makePrisma(): Promise<{ prisma: PrismaClient; close: () => Promise<void> }> {
  if (process.env.TEST_PRISMA_MODE === 'wasm') {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const { PrismaClient: WasmClient } = require('../../.testclient/wasm.js');
    const { PrismaPg } = require('@prisma/adapter-pg');
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const prisma = new WasmClient({ adapter: new PrismaPg(pool) }) as PrismaClient;
    return { prisma, close: async () => { await prisma.$disconnect(); await pool.end(); } };
  }
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return { prisma, close: () => prisma.$disconnect() };
}

/** Safety: this helper DROPS the public schema, so it only ever runs against a database named *test*. */
function assertTestDatabase() {
  const dbName = new URL(url).pathname.replace('/', '');
  if (!/test/i.test(dbName)) throw new Error(`Refusing to reset database "${dbName}": name must contain "test"`);
}

/** Drops everything and applies the checked-in migration SQL — exactly what `prisma migrate deploy` runs. */
export async function migrateFresh() {
  assertTestDatabase();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    const dir = join(__dirname, '../../prisma/migrations');
    for (const m of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
      await client.query(readFileSync(join(dir, m, 'migration.sql'), 'utf8'));
    }
  } finally {
    await client.end();
  }
}

export async function truncateAll(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname = 'public'`;
  const names = rows.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
}
