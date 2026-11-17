// Sandbox-only: boots the REAL app (buildApp) on :4000 using the wasm Prisma client, for HTTP-level checks.
import { createRequire } from 'node:module';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import { runSeed } from '../../prisma/seed.js';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../.testclient/wasm.js');
const { PrismaPg } = require('@prisma/adapter-pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
await runSeed(prisma, { bcryptRounds: 4 });
const app = await buildApp({ prisma, logger: false });
await app.listen({ port: 4000, host: '127.0.0.1' });
console.log('READY');
