import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient, Role } from '@prisma/client';
import { buildApp, AppOptions } from '../../src/app.js';
import { makePrisma, migrateFresh, truncateAll } from './db.js';

export interface Ctx { app: FastifyInstance; prisma: PrismaClient; close: () => Promise<void> }

/** Fresh migrated DB + running app for a test file. */
export async function setup(opts: Partial<AppOptions> = {}): Promise<Ctx> {
  await migrateFresh();
  const { prisma, close } = await makePrisma();
  const app = await buildApp({ prisma, logger: false, rateLimit: false, ...opts });
  await app.ready();
  return { app, prisma, close: async () => { await app.close(); await close(); } };
}
export { truncateAll };

const PASS = 'Passw0rd!test';
let n = 0;

export async function makeUser(prisma: PrismaClient, role: Role, over: Record<string, unknown> = {}) {
  n += 1;
  return prisma.user.create({
    data: {
      email: `${role.toLowerCase()}${n}@test.dev`, passwordHash: await bcrypt.hash(PASS, 4), role,
      firstName: `First${n}`, lastName: `Last${n}`, ...over,
    },
  });
}

export async function makeStudent(prisma: PrismaClient, over: { cgpa?: number; backlogs?: number; branch?: string; roll?: string } = {}) {
  n += 1;
  const user = await makeUser(prisma, 'STUDENT');
  const student = await prisma.student.create({
    data: {
      userId: user.id, rollNumber: over.roll ?? `R${n}${Date.now() % 100000}`, branch: over.branch ?? 'CSE', year: 3,
      cgpa: over.cgpa ?? 7.5, backlogs: over.backlogs ?? 0,
      skills: { create: { dsaPct: 60, aptitudePct: 60, communicationPct: 60, domainPct: 60, mockInterviewPct: 60 } },
    },
  });
  return { user, student };
}

export async function makeMentor(prisma: PrismaClient) {
  const user = await makeUser(prisma, 'MENTOR');
  const mentor = await prisma.mentor.create({ data: { userId: user.id, specialty: 'DSA' } });
  return { user, mentor };
}

export async function login(app: FastifyInstance, email: string, password = PASS) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed ${res.statusCode}: ${res.body}`);
  const b = res.json();
  return { token: b.token as string, refreshToken: b.refreshToken as string, user: b.user };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
export const TEST_PASSWORD = PASS;

/** Convenience: create a user with `role`, log them in, return everything. */
export async function asRole(ctx: Ctx, role: Role) {
  const user = await makeUser(ctx.prisma, role);
  const { token, refreshToken } = await login(ctx.app, user.email);
  return { user, token, refreshToken, h: bearer(token) };
}
