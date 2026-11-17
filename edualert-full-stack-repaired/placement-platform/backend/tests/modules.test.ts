import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setup, truncateAll, Ctx, makeStudent, makeMentor, asRole, login, bearer, makeUser } from './helpers/app.js';

vi.mock('../src/services/email.js', async (orig) => {
  const real = await orig<typeof import('../src/services/email.js')>();
  return { ...real, sendBookingConfirmation: vi.fn(async () => { throw new Error('SMTP down'); }) };
});

let ctx: Ctx;
beforeAll(async () => { ctx = await setup(); });
afterAll(async () => { await ctx.close(); });
beforeEach(async () => { await truncateAll(ctx.prisma); });
const rq = (method: string, url: string, h: any = {}, payload?: unknown) => ctx.app.inject({ method: method as any, url, headers: h, payload: payload as any });
const studentH = async (o = {}) => { const s = await makeStudent(ctx.prisma, o); return { ...s, h: bearer((await login(ctx.app, s.user.email)).token) }; };
const mentorH = async () => { const m = await makeMentor(ctx.prisma); return { ...m, h: bearer((await login(ctx.app, m.user.email)).token) }; };
const future = (h: number, len = 1) => ({ startTime: new Date(Date.now() + h * 3600_000).toISOString(), endTime: new Date(Date.now() + (h + len) * 3600_000).toISOString() });

describe('companies / placement drives', () => {
  const drive = { name: 'Acme', sector: 'IT', minCgpa: 7, maxBacklogs: 0, eligibleBranches: ['cse'], status: 'OPEN', ctcMin: 100, ctcMax: 200 };

  it('officer CRUD; students/mentors cannot write; validation enforced', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER'); const s = await studentH();
    expect((await rq('POST', '/api/companies', s.h, drive)).statusCode).toBe(403);
    expect((await rq('POST', '/api/companies', o.h, { ...drive, minCgpa: 11 })).statusCode).toBe(400);
    expect((await rq('POST', '/api/companies', o.h, { ...drive, ctcMin: 500 })).statusCode).toBe(400);
    expect((await rq('POST', '/api/companies', o.h, { ...drive, id: 'x' })).statusCode).toBe(400);
    const c = await rq('POST', '/api/companies', o.h, drive);
    expect(c.statusCode).toBe(201);
    expect(c.json().eligibleBranches).toEqual(['CSE']);
    const id = c.json().id;
    expect((await rq('PATCH', `/api/companies/${id}`, o.h, { status: 'CLOSED' })).json().status).toBe('CLOSED');
    expect((await rq('PATCH', `/api/companies/${id}`, o.h, { status: 'NOPE' })).statusCode).toBe(400);
    expect((await rq('PATCH', '/api/companies/00000000-0000-4000-8000-000000000000', o.h, { name: 'x' })).statusCode).toBe(404);
    expect((await rq('DELETE', `/api/companies/${id}`, o.h)).statusCode).toBe(204);
    expect((await rq('DELETE', `/api/companies/${id}`, o.h)).statusCode).toBe(404);
  });

  it('students see server-computed eligibility; apply enforces eligibility, status, idempotency; withdraw works', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER');
    const good = await studentH({ cgpa: 8, backlogs: 0, branch: 'CSE' });
    const bad = await studentH({ cgpa: 5, backlogs: 3, branch: 'MECH' });
    const open = (await rq('POST', '/api/companies', o.h, drive)).json();
    const closed = (await rq('POST', '/api/companies', o.h, { ...drive, name: 'Old', status: 'CLOSED' })).json();

    const list = (await rq('GET', '/api/companies', bad.h)).json();
    const row = list.find((c: any) => c.id === open.id);
    expect(row.eligibility.eligible).toBe(false);
    expect(row.eligibility.reasons).toHaveLength(3);
    expect((await rq('GET', '/api/companies', good.h)).json().find((c: any) => c.id === open.id).eligibility.eligible).toBe(true);

    expect((await rq('POST', `/api/companies/${open.id}/apply`, bad.h)).statusCode).toBe(403);
    expect((await rq('POST', `/api/companies/${closed.id}/apply`, good.h)).statusCode).toBe(409);
    expect((await rq('POST', '/api/companies/00000000-0000-4000-8000-000000000000/apply', good.h)).statusCode).toBe(404);
    expect((await rq('POST', `/api/companies/${open.id}/apply`, good.h)).statusCode).toBe(201);
    expect((await rq('POST', `/api/companies/${open.id}/apply`, good.h)).statusCode).toBe(200); // idempotent
    expect(await ctx.prisma.application.count()).toBe(1);
    expect((await rq('GET', '/api/companies/eligible', good.h)).json().map((c: any) => c.id)).toEqual([open.id]);
    expect((await rq('GET', '/api/companies/applications/mine', good.h)).json()).toHaveLength(1);

    // officer pipeline
    const apps = (await rq('GET', `/api/companies/${open.id}/applications`, o.h)).json();
    expect(apps).toHaveLength(1);
    expect(JSON.stringify(apps)).not.toMatch(/passwordHash/);
    expect((await rq('GET', `/api/companies/${open.id}/applications`, good.h)).statusCode).toBe(403);
    expect((await rq('PATCH', `/api/companies/applications/${apps[0].id}`, good.h, { status: 'SELECTED' })).statusCode).toBe(403);
    expect((await rq('PATCH', `/api/companies/applications/${apps[0].id}`, o.h, { status: 'BOGUS' })).statusCode).toBe(400);
    expect((await rq('PATCH', `/api/companies/applications/${apps[0].id}`, o.h, { status: 'SHORTLISTED' })).json().status).toBe('SHORTLISTED');
    expect((await rq('DELETE', `/api/companies/${open.id}/apply`, good.h)).statusCode).toBe(409); // already processed
  });
});

describe('mentors + bookings', () => {
  it('mentor edits only own descriptive fields — rating / ownership are rejected', async () => {
    const m = await mentorH();
    expect((await rq('PATCH', '/api/mentors/me', m.h, { bio: 'hello', specialty: 'HR' })).json()).toMatchObject({ bio: 'hello', specialty: 'HR' });
    for (const bad of [{ rating: 5 }, { sessionsCompleted: 999 }, { userId: 'x' }, {}]) expect((await rq('PATCH', '/api/mentors/me', m.h, bad)).statusCode).toBe(400);
    const s = await studentH();
    expect((await rq('PATCH', '/api/mentors/me', s.h, { bio: 'x' })).statusCode).toBe(403);
    const list = await rq('GET', '/api/mentors', s.h);
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toMatch(/passwordHash|email/);
  });

  it('slot creation validates times, overlap and role', async () => {
    const m = await mentorH(); const s = await studentH();
    expect((await rq('POST', '/api/bookings/mentor/slots', s.h, future(2))).statusCode).toBe(403);
    expect((await rq('POST', '/api/bookings/mentor/slots', m.h, future(-3))).statusCode).toBe(400);
    expect((await rq('POST', '/api/bookings/mentor/slots', m.h, { startTime: future(5).endTime, endTime: future(5).startTime })).statusCode).toBe(400);
    expect((await rq('POST', '/api/bookings/mentor/slots', m.h, { startTime: 'garbage', endTime: 'x' })).statusCode).toBe(400);
    expect((await rq('POST', '/api/bookings/mentor/slots', m.h, future(5, 6))).statusCode).toBe(400);
    expect((await rq('POST', '/api/bookings/mentor/slots', m.h, future(5))).statusCode).toBe(201);
    expect((await rq('POST', '/api/bookings/mentor/slots', m.h, future(5.5))).statusCode).toBe(409);
  });

  it('full flow: browse → book → my bookings → mentor sees it → cancel frees it; no secrets leak', async () => {
    const m = await mentorH(); const s = await studentH(); const s2 = await studentH();
    const slot = (await rq('POST', '/api/bookings/mentor/slots', m.h, future(24))).json();
    expect((await rq('GET', '/api/bookings/slots', s.h)).json().map((x: any) => x.id)).toEqual([slot.id]);

    const b = await rq('POST', '/api/bookings/book', s.h, { slotId: slot.id, notes: 'help with DP' });
    expect(b.statusCode).toBe(201); // e-mail transport is mocked to FAIL: booking must still succeed
    expect(b.json().emailSent).toBe(false);
    expect(b.body).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect((await rq('GET', '/api/bookings/slots', s.h)).json()).toHaveLength(0);
    expect((await rq('POST', '/api/bookings/book', s2.h, { slotId: slot.id })).statusCode).toBe(409);

    const mine = await rq('GET', '/api/bookings/mine', s.h);
    expect(mine.json()).toHaveLength(1);
    expect(mine.body).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect((await rq('GET', '/api/bookings/mine', s2.h)).json()).toHaveLength(0);

    const ms = (await rq('GET', '/api/bookings/mentor/slots', m.h)).json();
    expect(ms[0].booking.notes).toBe('help with DP');
    expect((await rq('DELETE', `/api/bookings/mentor/slots/${slot.id}`, m.h)).statusCode).toBe(409); // booked

    const id = b.json().id;
    expect((await rq('DELETE', `/api/bookings/${id}`, s2.h)).statusCode).toBe(404); // not the owner
    expect((await rq('DELETE', `/api/bookings/${id}`, s.h)).statusCode).toBe(204);
    expect((await rq('GET', '/api/bookings/slots', s2.h)).json()).toHaveLength(1); // slot free again
    expect((await rq('DELETE', `/api/bookings/mentor/slots/${slot.id}`, m.h)).statusCode).toBe(204);
    expect((await rq('GET', '/api/bookings/slots', s2.h)).json()).toHaveLength(0);
  });

  it('two students racing for one slot: exactly one wins (no double booking)', async () => {
    const m = await mentorH(); const a = await studentH(); const b = await studentH(); const c = await studentH();
    const slot = (await rq('POST', '/api/bookings/mentor/slots', m.h, future(10))).json();
    const res = await Promise.all([a, b, c].map((x) => rq('POST', '/api/bookings/book', x.h, { slotId: slot.id })));
    expect(res.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
    expect(await ctx.prisma.booking.count()).toBe(1);
  });

  it('non-students cannot book; bad ids/payloads are 400/409', async () => {
    const m = await mentorH(); const s = await studentH();
    expect((await rq('POST', '/api/bookings/book', m.h, { slotId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(403);
    expect((await rq('POST', '/api/bookings/book', s.h, { slotId: 'nope' })).statusCode).toBe(400);
    expect((await rq('POST', '/api/bookings/book', s.h, { slotId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(409);
    expect((await rq('GET', '/api/bookings/slots')).statusCode).toBe(401);
  });
});

describe('courses / lectures', () => {
  const course = { title: 'Graphs', category: 'DSA', description: 'd' };
  const lesson = { title: 'BFS', videoUrl: 'https://cdn.test/bfs.mp4', durationSeconds: 100 };

  it('CMS: officer creates course + lessons (totalLessons kept in sync); students cannot; mentors only own', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER'); const s = await studentH(); const m = await mentorH();
    expect((await rq('POST', '/api/courses', s.h, course)).statusCode).toBe(403);
    expect((await rq('POST', '/api/courses', o.h, { ...course, category: 'NOPE' })).statusCode).toBe(400);
    expect((await rq('POST', '/api/courses', o.h, { ...course, instructorId: 'x' })).statusCode).toBe(400);
    const c = (await rq('POST', '/api/courses', o.h, course)).json();
    expect((await rq('POST', `/api/courses/${c.id}/lessons`, o.h, { ...lesson, videoUrl: 'javascript:1' })).statusCode).toBe(400);
    const l1 = (await rq('POST', `/api/courses/${c.id}/lessons`, o.h, lesson)).json();
    const l2 = (await rq('POST', `/api/courses/${c.id}/lessons`, o.h, { ...lesson, title: 'DFS' })).json();
    expect([l1.orderIndex, l2.orderIndex]).toEqual([1, 2]);
    expect((await rq('GET', `/api/courses/${c.id}`, s.h)).json()).toMatchObject({ totalLessons: 2 });
    expect((await rq('PATCH', `/api/courses/${c.id}/lessons/${l1.id}`, o.h, { title: 'BFS 2' })).json().title).toBe('BFS 2');
    expect((await rq('DELETE', `/api/courses/${c.id}/lessons/${l2.id}`, o.h)).statusCode).toBe(204);
    expect((await rq('GET', `/api/courses/${c.id}`, s.h)).json().totalLessons).toBe(1);
    expect((await rq('PATCH', `/api/courses/${c.id}`, m.h, { title: 'hijack' })).statusCode).toBe(403); // not their course
    const mc = (await rq('POST', '/api/courses', m.h, course)).json();
    expect((await rq('PATCH', `/api/courses/${mc.id}`, m.h, { title: 'mine' })).statusCode).toBe(200);
    expect((await rq('GET', '/api/courses?category=DSA&search=min', s.h)).json()).toHaveLength(1);
    expect((await rq('GET', '/api/courses?category=BAD', s.h)).statusCode).toBe(400);
    expect((await rq('DELETE', `/api/courses/${c.id}`, o.h)).statusCode).toBe(204);
    expect((await rq('GET', `/api/courses/${c.id}`, s.h)).statusCode).toBe(404);
  });

  it('progress is clamped + validated, completion unlocks certificate, quiz hides answers and cannot be gamed', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER'); const s = await studentH();
    const c = (await rq('POST', '/api/courses', o.h, course)).json();
    const l = (await rq('POST', `/api/courses/${c.id}/lessons`, o.h, lesson)).json();
    const q = (await rq('POST', `/api/courses/lessons/${l.id}/quizzes`, o.h, { title: 'Q', questions: [
      { text: 'a?', options: ['x', 'y'], correctOption: 1 }, { text: 'b?', options: ['x', 'y', 'z'], correctOption: 2 } ] })).json();
    expect((await rq('POST', `/api/courses/lessons/${l.id}/quizzes`, o.h, { title: 'Q', questions: [{ text: 'a', options: ['x', 'y'], correctOption: 5 }] })).statusCode).toBe(400);

    // quiz delivery never includes correctOption
    const quiz = await rq('GET', `/api/courses/quizzes/${q.id}`, s.h);
    expect(quiz.body).not.toMatch(/correctOption/);
    const qs = quiz.json().questions;

    expect((await rq('POST', `/api/courses/${c.id}/certificate`, s.h)).statusCode).toBe(400); // not complete yet
    expect((await rq('POST', '/api/courses/lesson-progress', s.h, { lessonId: l.id, watchedSeconds: -5 })).statusCode).toBe(400);
    expect((await rq('POST', '/api/courses/lesson-progress', s.h, { lessonId: '00000000-0000-4000-8000-000000000000', watchedSeconds: 5 })).statusCode).toBe(404);
    const half = (await rq('POST', '/api/courses/lesson-progress', s.h, { lessonId: l.id, watchedSeconds: 50 })).json();
    expect(half.completedAt).toBeNull();
    const done = (await rq('POST', '/api/courses/lesson-progress', s.h, { lessonId: l.id, watchedSeconds: 80000 })).json();
    expect(done.watchedSeconds).toBe(100); // clamped to the video length
    expect(done.completedAt).not.toBeNull();
    expect(await ctx.prisma.activityLog.count()).toBe(1); // pings are de-duplicated
    expect((await rq('GET', `/api/courses/${c.id}/progress`, s.h)).json()).toHaveLength(1);

    const cert = await rq('POST', `/api/courses/${c.id}/certificate`, s.h);
    expect(cert.statusCode).toBe(200);
    expect((await rq('POST', `/api/courses/${c.id}/certificate`, s.h)).json().id).toBe(cert.json().id); // idempotent

    // repeating one correct answer must not inflate the score above 50%
    const spam = Array(10).fill({ questionId: qs[0].id, chosenIndex: 1 });
    const a1 = (await rq('POST', '/api/courses/quiz-attempt', s.h, { quizId: q.id, answers: spam })).json();
    expect(a1.score).toBeLessThanOrEqual(50);
    const full = (await ctx.prisma.quizQuestion.findMany({ where: { quizId: q.id } })).map((x) => ({ questionId: x.id, chosenIndex: x.correctOption }));
    expect((await rq('POST', '/api/courses/quiz-attempt', s.h, { quizId: q.id, answers: full })).json()).toMatchObject({ score: 100, correct: 2, total: 2 });
    expect((await rq('POST', '/api/courses/quiz-attempt', s.h, { quizId: q.id, answers: 'nope' })).statusCode).toBe(400);
  });

  it('recommendations come from the weakest skill categories', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER'); const s = await studentH();
    await ctx.prisma.studentSkill.update({ where: { studentId: s.student.id }, data: { dsaPct: 5, aptitudePct: 90, communicationPct: 90, domainPct: 90 } });
    await rq('POST', '/api/courses', o.h, course);
    await rq('POST', '/api/courses', o.h, { ...course, title: 'Apt', category: 'APTITUDE' });
    const rec = (await rq('GET', '/api/courses/recommended/me', s.h)).json();
    expect(rec.map((c: any) => c.category)).toContain('DSA');
  });
});

describe('announcements + alerts', () => {
  it('officers manage announcements; everyone reads; pinned first; students cannot write', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER'); const s = await studentH();
    expect((await rq('POST', '/api/announcements', s.h, { title: 't', body: 'b' })).statusCode).toBe(403);
    expect((await rq('POST', '/api/announcements', o.h, { title: '', body: 'b' })).statusCode).toBe(400);
    const a = (await rq('POST', '/api/announcements', o.h, { title: 'old', body: 'b' })).json();
    const p = (await rq('POST', '/api/announcements', o.h, { title: 'pin', body: 'b', pinned: true })).json();
    const list = await rq('GET', '/api/announcements', s.h);
    expect(list.json().map((x: any) => x.title)).toEqual(['pin', 'old']);
    expect(list.body).not.toMatch(/passwordHash|email/);
    expect((await rq('PATCH', `/api/announcements/${a.id}`, o.h, { pinned: true })).json().pinned).toBe(true);
    expect((await rq('PATCH', `/api/announcements/${a.id}`, s.h, { pinned: false })).statusCode).toBe(403);
    expect((await rq('DELETE', `/api/announcements/${p.id}`, s.h)).statusCode).toBe(403);
    expect((await rq('DELETE', `/api/announcements/${p.id}`, o.h)).statusCode).toBe(204);
    expect((await rq('DELETE', `/api/announcements/${p.id}`, o.h)).statusCode).toBe(404);
  });

  it('alerts: officer sees all and can resolve; a student sees only their own', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER'); const a = await studentH(); const b = await studentH();
    const al = (await rq('POST', '/api/alerts', o.h, { studentId: a.student.id, level: 'HIGH', message: 'low activity' })).json();
    await rq('POST', '/api/alerts', o.h, { studentId: b.student.id, message: 'other' });
    expect((await rq('POST', '/api/alerts', a.h, { studentId: a.student.id, message: 'x' })).statusCode).toBe(403);
    expect((await rq('POST', '/api/alerts', o.h, { studentId: '00000000-0000-4000-8000-000000000000', message: 'x' })).statusCode).toBe(404);
    expect((await rq('GET', '/api/alerts', o.h)).json()).toHaveLength(2);
    const mine = (await rq('GET', '/api/alerts', a.h)).json();
    expect(mine).toHaveLength(1); expect(mine[0].message).toBe('low activity');
    expect((await rq('PATCH', `/api/alerts/${al.id}/resolve`, a.h)).statusCode).toBe(403);
    expect((await rq('PATCH', `/api/alerts/${al.id}/resolve`, o.h)).json().resolvedAt).not.toBeNull();
    expect((await rq('GET', '/api/alerts?resolved=false', o.h)).json()).toHaveLength(1);
    expect((await rq('GET', '/api/alerts', (await mentorH()).h)).statusCode).toBe(403);
  });
});

describe('analytics', () => {
  it('officer analytics are SQL-backed; students are refused; leaderboard hides peers\' risk + ids', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER'); const a = await studentH(); await studentH({ branch: 'ECE' });
    const { recordScore } = await import('../src/services/risk-scoring.js');
    for (const id of (await ctx.prisma.student.findMany()).map((x) => x.id)) await recordScore(ctx.prisma, id);
    const sum = (await rq('GET', '/api/analytics/summary', o.h)).json();
    expect(sum.students).toBe(2);
    expect(sum.riskDistribution).toEqual({ HIGH: 0, MEDIUM: 0, LOW: 2 });
    expect((await rq('GET', '/api/analytics/branch-breakdown', o.h)).json()).toHaveLength(2);
    expect((await rq('GET', '/api/analytics/risk-trends', o.h)).json()[0].avgScore).toBeGreaterThan(0);
    expect(Array.isArray((await rq('GET', '/api/analytics/engagement', o.h)).json())).toBe(true);
    for (const p of ['summary', 'risk-trends', 'branch-breakdown', 'engagement']) expect((await rq('GET', `/api/analytics/${p}`, a.h)).statusCode).toBe(403);

    const sl = (await rq('GET', '/api/analytics/leaderboard', a.h)).json();
    expect(sl).toHaveLength(2);
    expect(Object.keys(sl[0]).sort()).toEqual(['branch', 'displayName', 'isYou', 'placementScore', 'rank']);
    expect(sl.filter((x: any) => x.isYou)).toHaveLength(1);
    const ol = (await rq('GET', '/api/analytics/leaderboard', o.h)).json();
    expect(ol[0]).toHaveProperty('riskLevel');
  });
});

describe('progress validation bounds', () => {
  it('rejects absurd watchedSeconds with 400', async () => {
    const s = await studentH();
    expect((await rq('POST', '/api/courses/lesson-progress', s.h, { lessonId: '00000000-0000-4000-8000-000000000000', watchedSeconds: 1e9 })).statusCode).toBe(400);
  });
});
