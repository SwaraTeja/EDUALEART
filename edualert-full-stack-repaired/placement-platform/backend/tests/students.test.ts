import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setup, truncateAll, Ctx, makeStudent, makeMentor, asRole, login, bearer, TEST_PASSWORD } from './helpers/app.js';

let ctx: Ctx;
beforeAll(async () => { ctx = await setup(); });
afterAll(async () => { await ctx.close(); });
beforeEach(async () => { await truncateAll(ctx.prisma); });

const req = (method: string, url: string, h: any, payload?: unknown) => ctx.app.inject({ method: method as any, url, headers: h, payload: payload as any });
const body = (o: Record<string, unknown> = {}) => ({ email: 'Ana@Test.dev', firstName: 'Ana', lastName: 'Lee', rollNumber: 'CSE100', branch: 'cse', year: 3, cgpa: 8.1, ...o });

describe('student CRUD — officer', () => {
  it('create → get → list → update → delete, persisted in PostgreSQL', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER');
    const c = await req('POST', '/api/students', o.h, body());
    expect(c.statusCode).toBe(201);
    const created = c.json();
    expect(created).toMatchObject({ rollNumber: 'CSE100', branch: 'CSE', cgpa: 8.1, backlogs: 0, emailed: false });
    expect(created.user).toEqual(expect.objectContaining({ email: 'ana@test.dev' }));
    expect(c.body).not.toMatch(/passwordHash/);
    expect(created.setPasswordUrl).toContain('/reset?token=');

    // an initial placement score exists immediately (not only after the 02:00 cron)
    expect(await ctx.prisma.studentScore.count({ where: { studentId: created.id } })).toBe(1);

    const g = await req('GET', `/api/students/${created.id}`, o.h);
    expect(g.statusCode).toBe(200);
    expect(g.body).not.toMatch(/passwordHash/);

    const l = await req('GET', '/api/students', o.h);
    expect(l.statusCode).toBe(200);
    expect(l.headers['x-total-count']).toBe('1');
    expect(l.json()[0].id).toBe(created.id);

    const u = await req('PATCH', `/api/students/${created.id}`, o.h, { cgpa: 5.5, backlogs: 2, firstName: 'Anna' });
    expect(u.statusCode).toBe(200);
    expect(u.json()).toMatchObject({ cgpa: 5.5, backlogs: 2, user: { firstName: 'Anna' } });
    expect(await ctx.prisma.studentScore.count({ where: { studentId: created.id } })).toBe(2); // re-scored

    expect((await req('DELETE', `/api/students/${created.id}`, o.h)).statusCode).toBe(204);
    expect((await req('GET', `/api/students/${created.id}`, o.h)).statusCode).toBe(404);
    expect(await ctx.prisma.user.count({ where: { email: 'ana@test.dev' } })).toBe(0);
    expect(await ctx.prisma.studentSkill.count()).toBe(0); // cascaded
    expect(await ctx.prisma.auditLog.count({ where: { action: { in: ['CREATE_STUDENT', 'UPDATE_STUDENT', 'DELETE_STUDENT'] } } })).toBe(3);
  });

  it('a created student can use the set-password link and then log in', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER');
    const c = (await req('POST', '/api/students', o.h, body())).json();
    const token = new URL(c.setPasswordUrl).searchParams.get('token')!;
    expect((await ctx.app.inject({ method: 'POST', url: '/api/auth/reset', payload: { token, newPassword: 'Student-pass-1' } })).statusCode).toBe(200);
    const s = await login(ctx.app, 'ana@test.dev', 'Student-pass-1');
    expect((await req('GET', '/api/students/me', bearer(s.token))).statusCode).toBe(200);
  });

  it.each([
    [{ cgpa: 11 }, /cgpa/], [{ cgpa: -1 }, /cgpa/], [{ year: 0 }, /year/], [{ backlogs: -2 }, /backlogs/],
    [{ email: 'bad' }, /email/], [{ rollNumber: '' }, /rollNumber/], [{ linkedinUrl: 'javascript:alert(1)' }, /linkedinUrl/], [{ role: 'ADMIN' }, /role|Unrecognized/],
  ])('rejects invalid create %j with 400', async (bad, re) => {
    const o = await asRole(ctx, 'TPC_OFFICER');
    const r = await req('POST', '/api/students', o.h, body(bad));
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(re);
  });

  it('prevents duplicate email / roll number (409) on create and update', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER');
    const a = (await req('POST', '/api/students', o.h, body())).json();
    expect((await req('POST', '/api/students', o.h, body({ rollNumber: 'X' }))).statusCode).toBe(409);
    expect((await req('POST', '/api/students', o.h, body({ email: 'b@test.dev' }))).statusCode).toBe(409);
    const b = (await req('POST', '/api/students', o.h, body({ email: 'b@test.dev', rollNumber: 'CSE200' }))).json();
    expect((await req('PATCH', `/api/students/${b.id}`, o.h, { rollNumber: 'CSE100' })).statusCode).toBe(409);
    expect((await req('PATCH', `/api/students/${a.id}`, o.h, { rollNumber: 'CSE100' })).statusCode).toBe(200); // same value on same record is fine
  });

  it('missing / malformed ids → 404 / 400, empty update → 400', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER');
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect((await req('GET', `/api/students/${ghost}`, o.h)).statusCode).toBe(404);
    expect((await req('PATCH', `/api/students/${ghost}`, o.h, { cgpa: 7 })).statusCode).toBe(404);
    expect((await req('DELETE', `/api/students/${ghost}`, o.h)).statusCode).toBe(404);
    expect((await req('GET', '/api/students/not-a-uuid', o.h)).statusCode).toBe(400);
    const s = await makeStudent(ctx.prisma);
    expect((await req('PATCH', `/api/students/${s.student.id}`, o.h, {})).statusCode).toBe(400);
  });

  it('pagination, search, branch and risk filters are applied in SQL (correct pages + totals)', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER');
    for (let i = 0; i < 5; i++) await req('POST', '/api/students', o.h, body({ email: `s${i}@test.dev`, rollNumber: `R0${i}`, branch: i < 3 ? 'CSE' : 'ECE', cgpa: i === 4 ? 1 : 9 }));
    const p1 = await req('GET', '/api/students?limit=2&page=1', o.h);
    const p3 = await req('GET', '/api/students?limit=2&page=3', o.h);
    expect(p1.json()).toHaveLength(2); expect(p1.headers['x-total-count']).toBe('5');
    expect(p3.json()).toHaveLength(1);
    expect((await req('GET', '/api/students?branch=ece', o.h)).json()).toHaveLength(2);
    expect((await req('GET', '/api/students?search=r04', o.h)).json()).toHaveLength(1);
    // skills are all zero for officer-created students, so score = cgpa part only: cgpa 1 → HIGH, cgpa 9 → HIGH too (18 < 30)
    const high = await req('GET', '/api/students?riskLevel=HIGH&limit=2&page=2', o.h);
    expect(high.headers['x-total-count']).toBe('5');
    expect(high.json()).toHaveLength(2);
    expect((await req('GET', '/api/students?riskLevel=LOW', o.h)).json()).toHaveLength(0);
    expect((await req('GET', '/api/students?page=0', o.h)).statusCode).toBe(400);
    expect((await req('GET', '/api/students?limit=1000', o.h)).statusCode).toBe(400);
  });

  it('officer can update skills, which re-scores', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER');
    const s = (await req('POST', '/api/students', o.h, body())).json();
    const r = await req('PUT', `/api/students/${s.id}/skills`, o.h, { dsaPct: 90, aptitudePct: 90, communicationPct: 90, domainPct: 90, mockInterviewPct: 90 });
    expect(r.statusCode).toBe(200);
    const latest = await ctx.prisma.studentScore.findFirst({ where: { studentId: s.id }, orderBy: { recordedAt: 'desc' } });
    expect(latest!.riskLevel).toBe('LOW');
    expect((await req('PUT', `/api/students/${s.id}/skills`, o.h, { dsaPct: 120 })).statusCode).toBe(400);
  });

  it('bulk import is all-or-nothing and validates every row', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER');
    const rows = [0, 1, 2].map((i) => body({ email: `b${i}@test.dev`, rollNumber: `B${i}` }));
    expect((await req('POST', '/api/students/bulk', o.h, rows)).json()).toEqual({ createdCount: 3 });
    const mixed = [body({ email: 'n1@test.dev', rollNumber: 'N1' }), body({ email: 'b0@test.dev', rollNumber: 'N2' })];
    const clash = await req('POST', '/api/students/bulk', o.h, mixed);
    expect(clash.statusCode).toBe(409);
    expect(await ctx.prisma.student.count()).toBe(3); // nothing from the failed batch was kept
    expect((await req('POST', '/api/students/bulk', o.h, [body({ cgpa: 99 })])).statusCode).toBe(400);
    expect((await req('POST', '/api/students/bulk', o.h, [body(), body()])).statusCode).toBe(409); // dup inside upload
    expect((await req('POST', '/api/students/bulk', o.h, [])).statusCode).toBe(400);
  });
});

describe('student authorization', () => {
  it('students cannot list, create, update or delete; unauthenticated is 401', async () => {
    const a = await makeStudent(ctx.prisma);
    const b = await makeStudent(ctx.prisma);
    const s = bearer((await login(ctx.app, a.user.email)).token);
    expect((await req('GET', '/api/students', s)).statusCode).toBe(403);
    expect((await req('POST', '/api/students', s, body())).statusCode).toBe(403);
    expect((await req('POST', '/api/students/bulk', s, [body()])).statusCode).toBe(403);
    expect((await req('PATCH', `/api/students/${b.student.id}`, s, { cgpa: 10 })).statusCode).toBe(403);
    expect((await req('PUT', `/api/students/${b.student.id}/skills`, s, { dsaPct: 100 })).statusCode).toBe(403);
    expect((await req('DELETE', `/api/students/${b.student.id}`, s)).statusCode).toBe(403);
    expect((await req('GET', '/api/students', {})).statusCode).toBe(401);
  });

  it('a student can read only their own record (not another student\'s)', async () => {
    const a = await makeStudent(ctx.prisma);
    const b = await makeStudent(ctx.prisma);
    const s = bearer((await login(ctx.app, a.user.email)).token);
    expect((await req('GET', `/api/students/${a.student.id}`, s)).statusCode).toBe(200);
    expect((await req('GET', `/api/students/${b.student.id}`, s)).statusCode).toBe(403);
    const me = await req('GET', '/api/students/me', s);
    expect(me.json().id).toBe(a.student.id);
    expect(me.body).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('a student may edit only phone/LinkedIn — academic fields and ownership are refused', async () => {
    const a = await makeStudent(ctx.prisma, { cgpa: 5 });
    const s = bearer((await login(ctx.app, a.user.email)).token);
    const ok = await req('PATCH', '/api/students', s, { phone: '+91 98765 43210', linkedinUrl: 'https://linkedin.com/in/me' });
    expect(ok.statusCode).toBe(200);
    for (const bad of [{ cgpa: 10 }, { backlogs: 0 }, { branch: 'X' }, { userId: 'x' }, { rollNumber: 'Z' }, { phone: 'abc' }, { linkedinUrl: 'javascript:alert(1)' }, {}]) {
      expect((await req('PATCH', '/api/students', s, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await ctx.prisma.student.findUnique({ where: { id: a.student.id } }))!.cgpa).toBe(5);
  });

  it('a mentor sees a student only after that student booked them, and with reduced fields', async () => {
    const st = await makeStudent(ctx.prisma);
    const other = await makeStudent(ctx.prisma);
    const m = await makeMentor(ctx.prisma);
    const mh = bearer((await login(ctx.app, m.user.email)).token);
    expect((await req('GET', `/api/students/${st.student.id}`, mh)).statusCode).toBe(403);
    const slot = await ctx.prisma.mentorSlot.create({ data: { mentorId: m.mentor.id, startTime: new Date(Date.now() + 86400000), endTime: new Date(Date.now() + 90000000), status: 'BOOKED' } });
    await ctx.prisma.booking.create({ data: { slotId: slot.id, studentId: st.student.id } });
    const r = await req('GET', `/api/students/${st.student.id}`, mh);
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.phone).toBeUndefined(); expect(j.alerts).toBeUndefined(); expect(j.user.email).toBeUndefined();
    expect((await req('GET', `/api/students/${other.student.id}`, mh)).statusCode).toBe(403);
    expect((await req('GET', '/api/students', mh)).statusCode).toBe(403);
  });

  it('deleting a student frees the mentor slot they had booked', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER');
    const st = await makeStudent(ctx.prisma); const m = await makeMentor(ctx.prisma);
    const slot = await ctx.prisma.mentorSlot.create({ data: { mentorId: m.mentor.id, startTime: new Date(Date.now() + 86400000), endTime: new Date(Date.now() + 90000000), status: 'BOOKED' } });
    await ctx.prisma.booking.create({ data: { slotId: slot.id, studentId: st.student.id } });
    expect((await req('DELETE', `/api/students/${st.student.id}`, o.h)).statusCode).toBe(204);
    expect((await ctx.prisma.mentorSlot.findUnique({ where: { id: slot.id } }))!.status).toBe('AVAILABLE');
    expect(await ctx.prisma.booking.count()).toBe(0);
  });

  it('ADMIN has the same student powers as an officer', async () => {
    const a = await asRole(ctx, 'ADMIN');
    expect((await req('POST', '/api/students', a.h, body())).statusCode).toBe(201);
  });

  it('resume upload: 503 when storage is not configured', async () => {
    const st = await makeStudent(ctx.prisma);
    const s = bearer((await login(ctx.app, st.user.email, TEST_PASSWORD)).token);
    expect((await req('POST', '/api/students/resume', s)).statusCode).toBe(503);
  });
});
