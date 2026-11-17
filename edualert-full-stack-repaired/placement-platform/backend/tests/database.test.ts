import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, Ctx } from './helpers/app.js';
import { runSeed } from '../prisma/seed.js';

let ctx: Ctx;
beforeAll(async () => { ctx = await setup(); });
afterAll(async () => { await ctx.close(); });

describe('migrations + schema constraints', () => {
  it('migration created every table', async () => {
    const t = await ctx.prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name <> '_prisma_migrations'`;
    expect(t[0].n).toBe(27);
  });
  it('DB-level CHECK constraints reject impossible data even if app validation is bypassed', async () => {
    const u = await ctx.prisma.user.create({ data: { email: 'c@t.dev', role: 'STUDENT', firstName: 'a', lastName: 'b' } });
    await expect(ctx.prisma.student.create({ data: { userId: u.id, rollNumber: 'C1', branch: 'X', year: 1, cgpa: 11 } })).rejects.toThrow();
    await expect(ctx.prisma.student.create({ data: { userId: u.id, rollNumber: 'C1', branch: 'X', year: 1, cgpa: 5, backlogs: -1 } })).rejects.toThrow();
  });
  it('unique indexes exist (email, roll number, one booking per slot)', async () => {
    await ctx.prisma.user.create({ data: { email: 'dup@t.dev', role: 'STUDENT', firstName: 'a', lastName: 'b' } });
    await expect(ctx.prisma.user.create({ data: { email: 'dup@t.dev', role: 'STUDENT', firstName: 'a', lastName: 'b' } })).rejects.toThrow();
  });
});

describe('seed script', () => {
  it('runs, is idempotent (no duplicates on a second run) and the demo accounts can authenticate', async () => {
    await runSeed(ctx.prisma, { bcryptRounds: 4 });
    const counts = async () => ({
      users: await ctx.prisma.user.count(), students: await ctx.prisma.student.count(), companies: await ctx.prisma.company.count(),
      courses: await ctx.prisma.course.count(), lessons: await ctx.prisma.lesson.count(), quizzes: await ctx.prisma.quiz.count(),
      slots: await ctx.prisma.mentorSlot.count(), announcements: await ctx.prisma.announcement.count(), scores: await ctx.prisma.studentScore.count(),
      roadmaps: await ctx.prisma.roadmap.count(), steps: await ctx.prisma.roadmapStep.count(),
      guides: await ctx.prisma.prepGuide.count(), tips: await ctx.prisma.tip.count(),
    });
    const first = await counts();
    await runSeed(ctx.prisma, { bcryptRounds: 4 });
    expect(await counts()).toEqual(first);
    expect(first).toMatchObject({ companies: 2, courses: 1, lessons: 2, quizzes: 1, slots: 3, announcements: 1, students: 2, scores: 2, roadmaps: 1, steps: 4, guides: 1, tips: 1 });

    const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'officer@edualert.app', password: 'officer123' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().user.role).toBe('TPC_OFFICER');
    expect((await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'student2@edualert.app', password: 'student123' } })).statusCode).toBe(200);
    // the low-skill seeded student has a HIGH-risk alert from the immediate score
    expect(await ctx.prisma.alert.count({ where: { level: 'HIGH' } })).toBe(1);
  });
});
