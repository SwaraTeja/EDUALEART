import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setup, truncateAll, Ctx, makeUser, makeStudent, login, bearer, asRole, TEST_PASSWORD } from './helpers/app.js';
import { signToken, passwordFingerprint } from '../src/lib/tokens.js';

let ctx: Ctx;
beforeAll(async () => { ctx = await setup(); });
afterAll(async () => { await ctx.close(); });
beforeEach(async () => { await truncateAll(ctx.prisma); });

const post = (url: string, payload: unknown, headers = {}) => ctx.app.inject({ method: 'POST', url, payload: payload as any, headers });
const signupBody = (o: Record<string, unknown> = {}) => ({
  email: 'New.Student@Test.dev', password: 'Sup3rSecret!', firstName: 'New', lastName: 'Student', rollNumber: 'CSE1', branch: 'cse', year: 2, ...o,
});

describe('health + CORS + generic error contract', () => {
  it('GET /health and /api/health report DB up', async () => {
    for (const url of ['/health', '/api/health']) {
      const r = await ctx.app.inject({ url });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ ok: true, db: 'up' });
    }
  });

  it('returns 503 when the database is unreachable', async () => {
    const { buildApp } = await import('../src/app.js');
    const broken: any = { $queryRaw: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:5432'); } };
    const app = await buildApp({ prisma: broken, logger: false, rateLimit: false });
    const r = await app.inject({ url: '/api/health' });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ ok: false, db: 'down' });
    expect(r.body).not.toContain('ECONNREFUSED');
    await app.close();
  });

  it('CORS preflight allows PATCH/DELETE from the configured origin only', async () => {
    const ok = await ctx.app.inject({ method: 'OPTIONS', url: '/api/students/x', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization,content-type' } });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(String(ok.headers['access-control-allow-methods'])).toMatch(/PATCH/);
    expect(String(ok.headers['access-control-allow-methods'])).toMatch(/DELETE/);

    const bad = await ctx.app.inject({ method: 'OPTIONS', url: '/api/students/x', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('unknown routes and malformed JSON return {error} JSON, never HTML / stack traces', async () => {
    const nf = await ctx.app.inject({ url: '/api/nope' });
    expect(nf.statusCode).toBe(404);
    expect(nf.json().error).toMatch(/not found/i);
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: '{bad json', headers: { 'content-type': 'application/json' } });
    expect(bad.statusCode).toBe(400);
    expect(typeof bad.json().error).toBe('string');
  });

  it('internal errors are logged but never leaked (no SQL / driver text)', async () => {
    const { buildApp } = await import('../src/app.js');
    const boom: any = { user: { findUnique: async () => { throw new Error('select * from "User" where password = secret'); } } };
    const app = await buildApp({ prisma: boom, logger: false, rateLimit: false });
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.co', password: 'x' } });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: 'Internal server error' });
    await app.close();
  });
});

describe('registration', () => {
  it('creates a STUDENT with a Student profile + skills row, normalises email/branch, hashes the password', async () => {
    const r = await post('/api/auth/signup', signupBody());
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ email: 'new.student@test.dev', role: 'STUDENT' });
    expect(r.body).not.toMatch(/passwordHash|\$2[aby]\$/);

    const u = await ctx.prisma.user.findUnique({ where: { email: 'new.student@test.dev' }, include: { student: { include: { skills: true } } } });
    expect(u!.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(u!.passwordHash).not.toContain('Sup3rSecret');
    expect(u!.student!.branch).toBe('CSE');
    expect(u!.student!.skills).not.toBeNull();

    // the brand-new student can log in and immediately load their dashboard data
    const { token } = await login(ctx.app, 'new.student@test.dev', 'Sup3rSecret!');
    const me = await ctx.app.inject({ url: '/api/students/me', headers: bearer(token) });
    expect(me.statusCode).toBe(200);
    expect(me.body).not.toContain('passwordHash');
  });

  it.each(['TPC_OFFICER', 'ADMIN', 'MENTOR', 'TPC Officer', 'TPC Admin', 'Student'])(
    'rejects a public signup that tries to choose role=%s',
    async (role) => {
      const r = await post('/api/auth/signup', signupBody({ role }));
      expect(r.statusCode).toBe(400);
      expect(await ctx.prisma.user.count()).toBe(0);
    }
  );

  it('rejects duplicate email (case-insensitive) and duplicate roll number with 409', async () => {
    expect((await post('/api/auth/signup', signupBody())).statusCode).toBe(201);
    expect((await post('/api/auth/signup', signupBody({ email: 'NEW.STUDENT@test.dev', rollNumber: 'OTHER' }))).statusCode).toBe(409);
    const roll = await post('/api/auth/signup', signupBody({ email: 'x@test.dev' }));
    expect(roll.statusCode).toBe(409);
    expect(roll.json().error).toMatch(/roll/i);
  });

  it.each([
    [{ password: 'short' }, /password/i],
    [{ email: 'not-an-email' }, /email/i],
    [{ year: 9 }, /year/i],
    [{ firstName: '' }, /firstName/i],
  ])('validates input %j', async (bad, re) => {
    const r = await post('/api/auth/signup', signupBody(bad));
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(re);
  });
});

describe('login, tokens, session lifecycle', () => {
  it('logs in and returns tokens + a user object without secrets', async () => {
    const u = await makeUser(ctx.prisma, 'STUDENT');
    const r = await post('/api/auth/login', { email: u.email.toUpperCase(), password: TEST_PASSWORD });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.token).toBeTruthy(); expect(b.refreshToken).toBeTruthy();
    expect(b.user).toEqual({ id: u.id, email: u.email, role: 'STUDENT', firstName: u.firstName, lastName: u.lastName });
    expect(r.body).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('invalid login is a uniform 401 (wrong password and unknown e-mail look identical)', async () => {
    const u = await makeUser(ctx.prisma, 'STUDENT');
    const a = await post('/api/auth/login', { email: u.email, password: 'wrong-password' });
    const b = await post('/api/auth/login', { email: 'ghost@test.dev', password: 'wrong-password' });
    expect(a.statusCode).toBe(401); expect(b.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
  });

  it('a provisioned account with no password yet cannot log in', async () => {
    const u = await makeUser(ctx.prisma, 'TPC_OFFICER', { passwordHash: null });
    expect((await post('/api/auth/login', { email: u.email, password: 'anything-at-all' })).statusCode).toBe(401);
  });

  it('a disabled account gets 403 on login, and its existing token stops working', async () => {
    const u = await asRole(ctx, 'STUDENT');
    await ctx.prisma.user.update({ where: { id: u.user.id }, data: { isActive: false } });
    expect((await post('/api/auth/login', { email: u.user.email, password: TEST_PASSWORD })).statusCode).toBe(403);
    expect((await ctx.app.inject({ url: '/api/auth/me', headers: u.h })).statusCode).toBe(401);
  });

  it('protected routes need a valid Bearer token; /me returns the current user', async () => {
    expect((await ctx.app.inject({ url: '/api/auth/me' })).statusCode).toBe(401);
    expect((await ctx.app.inject({ url: '/api/auth/me', headers: bearer('garbage') })).statusCode).toBe(401);
    const u = await asRole(ctx, 'MENTOR');
    const me = await ctx.app.inject({ url: '/api/auth/me', headers: u.h });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: u.user.id, role: 'MENTOR' });
  });

  it('an expired access token yields code TOKEN_EXPIRED so the client knows to refresh', async () => {
    const u = await makeUser(ctx.prisma, 'STUDENT');
    const expired = signToken('access', { id: u.id, tv: 0 }, '-10s');
    const r = await ctx.app.inject({ url: '/api/auth/me', headers: bearer(expired) });
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe('TOKEN_EXPIRED');
  });

  it('token kinds cannot be swapped (access / refresh / reset are mutually unusable)', async () => {
    const u = await makeUser(ctx.prisma, 'STUDENT');
    const { token, refreshToken } = await login(ctx.app, u.email);
    const reset = signToken('reset', { id: u.id, ph: passwordFingerprint(u.passwordHash) }, '1h');

    expect((await ctx.app.inject({ url: '/api/auth/me', headers: bearer(refreshToken) })).statusCode).toBe(401);
    expect((await ctx.app.inject({ url: '/api/auth/me', headers: bearer(reset) })).statusCode).toBe(401);
    expect((await post('/api/auth/refresh', { refreshToken: token })).statusCode).toBe(401);
    expect((await post('/api/auth/refresh', { refreshToken: reset })).statusCode).toBe(401);
    expect((await post('/api/auth/reset', { token: refreshToken, newPassword: 'N3wPassword!' })).statusCode).toBe(401);
    expect((await post('/api/auth/reset', { token, newPassword: 'N3wPassword!' })).statusCode).toBe(401);
  });

  it('a token signed with an unknown secret, or with alg=none, is rejected', async () => {
    const u = await makeUser(ctx.prisma, 'STUDENT');
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ id: u.id, typ: 'access', tv: 0 }, 'some-other-secret-some-other-secret-1234');
    expect((await ctx.app.inject({ url: '/api/auth/me', headers: bearer(forged) })).statusCode).toBe(401);
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ id: u.id, typ: 'access', tv: 0 })).toString('base64url')}.`;
    expect((await ctx.app.inject({ url: '/api/auth/me', headers: bearer(none) })).statusCode).toBe(401);
  });

  it('refresh issues a working access token; refresh for a disabled user fails', async () => {
    const u = await asRole(ctx, 'STUDENT');
    const r = await post('/api/auth/refresh', { refreshToken: u.refreshToken });
    expect(r.statusCode).toBe(200);
    expect((await ctx.app.inject({ url: '/api/auth/me', headers: bearer(r.json().token) })).statusCode).toBe(200);
    await ctx.prisma.user.update({ where: { id: u.user.id }, data: { isActive: false } });
    expect((await post('/api/auth/refresh', { refreshToken: u.refreshToken })).statusCode).toBe(401);
  });

  it('logout revokes the access token AND the refresh token immediately', async () => {
    const u = await asRole(ctx, 'STUDENT');
    expect((await post('/api/auth/logout', {}, u.h)).statusCode).toBe(200);
    expect((await ctx.app.inject({ url: '/api/auth/me', headers: u.h })).statusCode).toBe(401);
    expect((await post('/api/auth/refresh', { refreshToken: u.refreshToken })).statusCode).toBe(401);
    // a fresh login works again
    expect((await login(ctx.app, u.user.email)).token).toBeTruthy();
  });

  it('role is read from the database on every request, not from the token', async () => {
    const officer = await asRole(ctx, 'TPC_OFFICER');
    expect((await ctx.app.inject({ url: '/api/students', headers: officer.h })).statusCode).toBe(200);
    await ctx.prisma.user.update({ where: { id: officer.user.id }, data: { role: 'STUDENT' } });
    expect((await ctx.app.inject({ url: '/api/students', headers: officer.h })).statusCode).toBe(403);
  });
});

describe('password reset / set-password', () => {
  it('request-reset never reveals whether an e-mail exists', async () => {
    const u = await makeUser(ctx.prisma, 'STUDENT');
    const a = await post('/api/auth/request-reset', { email: u.email });
    const b = await post('/api/auth/request-reset', { email: 'ghost@test.dev' });
    expect(a.statusCode).toBe(200); expect(b.statusCode).toBe(200);
    expect(a.json()).toEqual(b.json());
  });

  it('a reset token works exactly once, then revokes old sessions', async () => {
    const u = await asRole(ctx, 'STUDENT');
    const row = (await ctx.prisma.user.findUnique({ where: { id: u.user.id } }))!;
    const token = signToken('reset', { id: row.id, ph: passwordFingerprint(row.passwordHash) }, '1h');

    expect((await post('/api/auth/reset', { token, newPassword: 'Brand-new-pass1' })).statusCode).toBe(200);
    expect((await post('/api/auth/reset', { token, newPassword: 'Another-pass-2' })).statusCode).toBe(401); // single use
    expect((await ctx.app.inject({ url: '/api/auth/me', headers: u.h })).statusCode).toBe(401); // old session revoked
    expect((await login(ctx.app, row.email, 'Brand-new-pass1')).token).toBeTruthy();
    expect((await post('/api/auth/login', { email: row.email, password: TEST_PASSWORD })).statusCode).toBe(401);
  });

  it('rejects weak new passwords and expired tokens', async () => {
    const u = await makeUser(ctx.prisma, 'STUDENT');
    const fp = passwordFingerprint(u.passwordHash);
    expect((await post('/api/auth/reset', { token: signToken('reset', { id: u.id, ph: fp }, '1h'), newPassword: 'short' })).statusCode).toBe(400);
    expect((await post('/api/auth/reset', { token: signToken('reset', { id: u.id, ph: fp }, '-1s'), newPassword: 'Long-enough-1' })).statusCode).toBe(401);
  });
});

describe('privileged-account provisioning (no self-service privilege escalation)', () => {
  const newOfficer = { email: 'Officer.New@test.dev', firstName: 'Olive', lastName: 'Officer', role: 'TPC_OFFICER' };

  it('anonymous, student, mentor and TPC officer callers are all refused', async () => {
    expect((await post('/api/admin/users', newOfficer)).statusCode).toBe(401);
    for (const role of ['STUDENT', 'MENTOR', 'TPC_OFFICER'] as const) {
      const u = await asRole(ctx, role);
      expect((await post('/api/admin/users', newOfficer, u.h)).statusCode).toBe(403);
    }
    expect(await ctx.prisma.user.count({ where: { email: 'officer.new@test.dev' } })).toBe(0);
  });

  it('an ADMIN can provision an officer, who then sets a password via the one-time link and logs in', async () => {
    const admin = await asRole(ctx, 'ADMIN');
    const r = await post('/api/admin/users', newOfficer, admin.h);
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(b).toMatchObject({ email: 'officer.new@test.dev', role: 'TPC_OFFICER', emailed: false });
    expect(r.body).not.toMatch(/passwordHash/);
    expect(b.setPasswordUrl).toMatch(/^http:\/\/localhost:3000\/reset\?token=/);

    const token = new URL(b.setPasswordUrl).searchParams.get('token')!;
    expect((await post('/api/auth/reset', { token, newPassword: 'Officer-pass-1' })).statusCode).toBe(200);
    expect((await post('/api/auth/reset', { token, newPassword: 'Officer-pass-2' })).statusCode).toBe(401);
    const session = await login(ctx.app, 'officer.new@test.dev', 'Officer-pass-1');
    expect(session.user.role).toBe('TPC_OFFICER');
    expect((await ctx.app.inject({ url: '/api/students', headers: bearer(session.token) })).statusCode).toBe(200);

    const audit = await ctx.prisma.auditLog.findMany({ where: { action: 'PROVISION_TPC_OFFICER' } });
    expect(audit).toHaveLength(1);
  });

  it('provisioning a MENTOR also creates the Mentor profile; STUDENT cannot be provisioned here', async () => {
    const admin = await asRole(ctx, 'ADMIN');
    const m = await post('/api/admin/users', { email: 'm@test.dev', firstName: 'M', lastName: 'M', role: 'MENTOR', specialty: 'HR' }, admin.h);
    expect(m.statusCode).toBe(201);
    expect(await ctx.prisma.mentor.count({ where: { userId: m.json().id, specialty: 'HR' } })).toBe(1);
    expect((await post('/api/admin/users', { email: 's@test.dev', firstName: 'S', lastName: 'S', role: 'STUDENT' }, admin.h)).statusCode).toBe(400);
    expect((await post('/api/admin/users', { ...newOfficer, role: 'TPC_OFFICER', isActive: true, passwordHash: 'x' }, admin.h)).statusCode).toBe(400);
  });

  it('an admin can disable an account (sessions die) but not their own', async () => {
    const admin = await asRole(ctx, 'ADMIN');
    const victim = await asRole(ctx, 'TPC_OFFICER');
    const own = await ctx.app.inject({ method: 'PATCH', url: `/api/admin/users/${admin.user.id}`, headers: admin.h, payload: { isActive: false } });
    expect(own.statusCode).toBe(400);
    const r = await ctx.app.inject({ method: 'PATCH', url: `/api/admin/users/${victim.user.id}`, headers: admin.h, payload: { isActive: false } });
    expect(r.statusCode).toBe(200);
    expect((await ctx.app.inject({ url: '/api/students', headers: victim.h })).statusCode).toBe(401);
    const list = await ctx.app.inject({ url: '/api/admin/users', headers: admin.h });
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toMatch(/passwordHash/);
  });
});

describe('rate limiting', () => {
  it('throttles repeated login attempts with 429', async () => {
    const limited = await setup({ rateLimit: true }).catch(() => null);
    // `setup` re-migrates the shared DB; use a separate app on the same prisma instead
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ prisma: ctx.prisma, logger: false, rateLimit: true });
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      codes.push((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.co', password: 'x' } })).statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
    await app.close();
    await limited?.close();
  });
});
