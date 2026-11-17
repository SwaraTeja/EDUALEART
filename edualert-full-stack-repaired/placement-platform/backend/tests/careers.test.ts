import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setup, truncateAll, Ctx, makeStudent, asRole, login, bearer } from './helpers/app.js';

let ctx: Ctx;
beforeAll(async () => { ctx = await setup(); });
afterAll(async () => { await ctx.close(); });
beforeEach(async () => { await truncateAll(ctx.prisma); });

const rq = (method: string, url: string, h: any = {}, payload?: unknown) =>
  ctx.app.inject({ method: method as any, url, headers: h, payload: payload as any });
const studentH = async (o = {}) => { const s = await makeStudent(ctx.prisma, o); return { ...s, h: bearer((await login(ctx.app, s.user.email)).token) }; };
const NOPE = '00000000-0000-4000-8000-000000000000';

describe('roadmaps', () => {
  it('only staff can write; validation enforced; unauthenticated is rejected', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER'); const s = await studentH(); const m = await asRole(ctx, 'MENTOR');
    expect((await rq('GET', '/api/roadmaps')).statusCode).toBe(401);
    expect((await rq('POST', '/api/roadmaps', s.h, { title: 'x' })).statusCode).toBe(403);
    expect((await rq('POST', '/api/roadmaps', m.h, { title: 'x' })).statusCode).toBe(403);
    expect((await rq('POST', '/api/roadmaps', o.h, { title: '' })).statusCode).toBe(400);
    expect((await rq('POST', '/api/roadmaps', o.h, { title: 'x', id: 'evil' })).statusCode).toBe(400);
    const r = await rq('POST', '/api/roadmaps', o.h, { title: 'SDE plan', targetRole: 'SDE' });
    expect(r.statusCode).toBe(201);
    expect(r.json().published).toBe(true);
    const id = r.json().id;
    expect((await rq('PATCH', `/api/roadmaps/${id}`, s.h, { title: 'hacked' })).statusCode).toBe(403);
    expect((await rq('PATCH', `/api/roadmaps/${id}`, o.h, {})).statusCode).toBe(400);
    expect((await rq('PATCH', `/api/roadmaps/${NOPE}`, o.h, { title: 'x' })).statusCode).toBe(404);
    expect((await rq('PATCH', '/api/roadmaps/not-a-uuid', o.h, { title: 'x' })).statusCode).toBe(400);
    expect((await rq('DELETE', `/api/roadmaps/${id}`, s.h)).statusCode).toBe(403);
    expect((await rq('DELETE', `/api/roadmaps/${id}`, o.h)).statusCode).toBe(204);
    expect((await rq('DELETE', `/api/roadmaps/${id}`, o.h)).statusCode).toBe(404);
  });

  it('steps are auto-ordered, validated, editable, and drafts are hidden from students', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER'); const s = await studentH();
    const pub = (await rq('POST', '/api/roadmaps', o.h, { title: 'Published' })).json();
    const draft = (await rq('POST', '/api/roadmaps', o.h, { title: 'Draft', published: false })).json();
    const a = await rq('POST', `/api/roadmaps/${pub.id}/steps`, o.h, { title: 'A', category: 'DSA', durationDays: 7 });
    const b = await rq('POST', `/api/roadmaps/${pub.id}/steps`, o.h, { title: 'B' });
    expect([a.json().orderIndex, b.json().orderIndex]).toEqual([0, 1]);
    expect((await rq('POST', `/api/roadmaps/${pub.id}/steps`, o.h, { title: 'bad', durationDays: 0 })).statusCode).toBe(400);
    expect((await rq('POST', `/api/roadmaps/${pub.id}/steps`, o.h, { title: 'bad', resourceUrl: 'javascript:alert(1)' })).statusCode).toBe(400);
    expect((await rq('POST', `/api/roadmaps/${pub.id}/steps`, o.h, { title: 'bad', category: 'NOPE' })).statusCode).toBe(400);
    expect((await rq('POST', `/api/roadmaps/${NOPE}/steps`, o.h, { title: 'x' })).statusCode).toBe(404);
    expect((await rq('POST', `/api/roadmaps/${pub.id}/steps`, s.h, { title: 'x' })).statusCode).toBe(403);
    expect((await rq('PATCH', `/api/roadmaps/steps/${b.json().id}`, o.h, { title: 'B2', orderIndex: 5 })).json()).toMatchObject({ title: 'B2', orderIndex: 5 });

    expect((await rq('GET', '/api/roadmaps', s.h)).json().map((r: any) => r.title)).toEqual(['Published']);
    expect((await rq('GET', '/api/roadmaps', o.h)).json().map((r: any) => r.title)).toEqual(['Draft', 'Published']);
    const list = (await rq('GET', '/api/roadmaps', s.h)).json();
    expect(list[0].steps.map((x: any) => x.title)).toEqual(['A', 'B2']);
    void draft;
  });

  it("a student's progress is private, idempotent, reversible, and drives progressPct", async () => {
    const o = await asRole(ctx, 'TPC_OFFICER'); const s1 = await studentH(); const s2 = await studentH();
    const r = (await rq('POST', '/api/roadmaps', o.h, { title: 'Plan' })).json();
    const step1 = (await rq('POST', `/api/roadmaps/${r.id}/steps`, o.h, { title: 'One' })).json();
    await rq('POST', `/api/roadmaps/${r.id}/steps`, o.h, { title: 'Two' });

    expect((await rq('POST', `/api/roadmaps/steps/${step1.id}/complete`, o.h)).statusCode).toBe(403); // staff are not students
    expect((await rq('POST', `/api/roadmaps/steps/${NOPE}/complete`, s1.h)).statusCode).toBe(404);
    expect((await rq('POST', `/api/roadmaps/steps/${step1.id}/complete`, s1.h)).json()).toEqual({ stepId: step1.id, done: true });
    expect((await rq('POST', `/api/roadmaps/steps/${step1.id}/complete`, s1.h)).statusCode).toBe(200); // idempotent
    expect(await ctx.prisma.roadmapProgress.count()).toBe(1);

    const mine = (await rq('GET', '/api/roadmaps', s1.h)).json()[0];
    expect(mine.progressPct).toBe(50);
    expect(mine.steps.map((x: any) => x.done)).toEqual([true, false]);
    const theirs = (await rq('GET', '/api/roadmaps', s2.h)).json()[0];
    expect(theirs.progressPct).toBe(0); // another student's progress is not visible

    expect((await rq('DELETE', `/api/roadmaps/steps/${step1.id}/complete`, s1.h)).json().done).toBe(false);
    expect((await rq('GET', '/api/roadmaps', s1.h)).json()[0].progressPct).toBe(0);
  });

  it('students cannot complete steps of unpublished roadmaps; deleting a roadmap cascades progress', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER'); const s = await studentH();
    const r = (await rq('POST', '/api/roadmaps', o.h, { title: 'Plan' })).json();
    const step = (await rq('POST', `/api/roadmaps/${r.id}/steps`, o.h, { title: 'One' })).json();
    expect((await rq('POST', `/api/roadmaps/steps/${step.id}/complete`, s.h)).statusCode).toBe(200);
    await rq('PATCH', `/api/roadmaps/${r.id}`, o.h, { published: false });
    expect((await rq('POST', `/api/roadmaps/steps/${step.id}/complete`, s.h)).statusCode).toBe(404);
    expect((await rq('DELETE', `/api/roadmaps/${r.id}`, o.h)).statusCode).toBe(204);
    expect(await ctx.prisma.roadmapStep.count()).toBe(0);
    expect(await ctx.prisma.roadmapProgress.count()).toBe(0);
  });
});

describe('preparation guides', () => {
  const guide = { title: 'Aptitude basics', category: 'APTITUDE', body: 'Practise daily.', summary: 'Short' };

  it('staff CRUD, validation, company link; non-staff cannot write', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER'); const s = await studentH();
    const co = await ctx.prisma.company.create({ data: { name: 'Acme' } });
    expect((await rq('GET', '/api/guides')).statusCode).toBe(401);
    expect((await rq('POST', '/api/guides', s.h, guide)).statusCode).toBe(403);
    expect((await rq('POST', '/api/guides', o.h, { ...guide, body: '' })).statusCode).toBe(400);
    expect((await rq('POST', '/api/guides', o.h, { ...guide, category: 'NOPE' })).statusCode).toBe(400);
    expect((await rq('POST', '/api/guides', o.h, { ...guide, companyId: NOPE })).statusCode).toBe(409);
    const g = await rq('POST', '/api/guides', o.h, { ...guide, companyId: co.id });
    expect(g.statusCode).toBe(201);
    expect(g.json().company).toEqual({ id: co.id, name: 'Acme' });
    const id = g.json().id;
    expect((await rq('PATCH', `/api/guides/${id}`, o.h, { title: 'Renamed' })).json().title).toBe('Renamed');
    expect((await rq('PATCH', `/api/guides/${id}`, s.h, { title: 'x' })).statusCode).toBe(403);
    // deleting the company keeps the guide (SET NULL)
    await ctx.prisma.company.delete({ where: { id: co.id } });
    expect((await rq('GET', `/api/guides/${id}`, s.h)).json().company).toBeNull();
    expect((await rq('DELETE', `/api/guides/${id}`, o.h)).statusCode).toBe(204);
    expect((await rq('DELETE', `/api/guides/${id}`, o.h)).statusCode).toBe(404);
  });

  it('filters by category and search; drafts are hidden from students (404) but visible to staff', async () => {
    const o = await asRole(ctx, 'TPC_OFFICER'); const s = await studentH();
    await rq('POST', '/api/guides', o.h, guide);
    await rq('POST', '/api/guides', o.h, { title: 'Mock interview tips', category: 'HR', body: 'Be concise.' });
    const draft = (await rq('POST', '/api/guides', o.h, { title: 'Secret draft', category: 'DSA', body: 'wip', published: false })).json();

    expect((await rq('GET', '/api/guides', s.h)).json()).toHaveLength(2);
    expect((await rq('GET', '/api/guides', o.h)).json()).toHaveLength(3);
    expect((await rq('GET', '/api/guides?category=HR', s.h)).json().map((g: any) => g.title)).toEqual(['Mock interview tips']);
    expect((await rq('GET', '/api/guides?search=aptitude', s.h)).json()).toHaveLength(1);
    expect((await rq('GET', '/api/guides?category=NOPE', s.h)).statusCode).toBe(400);
    expect((await rq('GET', `/api/guides/${draft.id}`, s.h)).statusCode).toBe(404);
    expect((await rq('GET', `/api/guides/${draft.id}`, o.h)).statusCode).toBe(200);
  });
});

describe('tips & actions', () => {
  const tip = { category: 'DSA', title: 'Practise DSA', body: 'One problem a day.', belowPct: 70, actionText: 'Open lectures', actionUrl: 'https://example.com/dsa' };

  it('only staff manage tips; validation rejects bad thresholds and unsafe URLs', async () => {
    const o = await asRole(ctx, 'ADMIN'); const s = await studentH(); const m = await asRole(ctx, 'MENTOR');
    expect((await rq('GET', '/api/tips', s.h)).statusCode).toBe(403);
    expect((await rq('GET', '/api/tips', m.h)).statusCode).toBe(403);
    expect((await rq('POST', '/api/tips', s.h, tip)).statusCode).toBe(403);
    expect((await rq('POST', '/api/tips', o.h, { ...tip, belowPct: 0 })).statusCode).toBe(400);
    expect((await rq('POST', '/api/tips', o.h, { ...tip, belowPct: 101 })).statusCode).toBe(400);
    expect((await rq('POST', '/api/tips', o.h, { ...tip, actionUrl: 'javascript:alert(1)' })).statusCode).toBe(400);
    const t = await rq('POST', '/api/tips', o.h, tip);
    expect(t.statusCode).toBe(201);
    expect(t.json().isActive).toBe(true);
    const id = t.json().id;
    expect((await rq('PATCH', `/api/tips/${id}`, o.h, { isActive: false })).json().isActive).toBe(false);
    expect((await rq('PATCH', `/api/tips/${NOPE}`, o.h, { title: 'x' })).statusCode).toBe(404);
    expect((await rq('DELETE', `/api/tips/${id}`, s.h)).statusCode).toBe(403);
    expect((await rq('DELETE', `/api/tips/${id}`, o.h)).statusCode).toBe(204);
  });

  it("GET /tips/me personalises from the caller's own skill scores, weakest first, active tips only", async () => {
    const o = await asRole(ctx, 'TPC_OFFICER');
    const weak = await studentH();
    const strong = await studentH();
    await ctx.prisma.studentSkill.update({ where: { studentId: weak.student.id }, data: { dsaPct: 20, aptitudePct: 50, communicationPct: 90 } });
    await ctx.prisma.studentSkill.update({ where: { studentId: strong.student.id }, data: { dsaPct: 95, aptitudePct: 95, communicationPct: 95, domainPct: 95, mockInterviewPct: 95 } });

    await rq('POST', '/api/tips', o.h, tip);                                                                   // DSA < 70
    await rq('POST', '/api/tips', o.h, { category: 'APTITUDE', title: 'Aptitude drills', body: 'x', belowPct: 60 });        // 50 < 60
    await rq('POST', '/api/tips', o.h, { category: 'COMMUNICATION', title: 'Speak up', body: 'x', belowPct: 60 });          // 90 ≥ 60 → hidden
    await rq('POST', '/api/tips', o.h, { category: 'HR', title: 'Inactive', body: 'x', belowPct: 100, isActive: false });   // inactive → hidden

    const res = await rq('GET', '/api/tips/me', weak.h);
    expect(res.statusCode).toBe(200);
    expect(res.json().tips.map((t: any) => [t.title, t.currentPct])).toEqual([['Practise DSA', 20], ['Aptitude drills', 50]]);
    expect(res.json().skills.dsaPct).toBe(20);
    expect((await rq('GET', '/api/tips/me', strong.h)).json().tips).toEqual([]);
    expect((await rq('GET', '/api/tips/me', o.h)).statusCode).toBe(403); // staff have no student profile
    expect((await rq('GET', '/api/tips/me')).statusCode).toBe(401);
  });
});
