import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { loginSchema, parseOrThrow, refreshSchema, requestResetSchema, resetSchema, signupSchema } from '../utils/validator.js';
import { passwordFingerprint, signToken, verifyToken } from '../lib/tokens.js';
import { authUserSelect } from '../lib/serializers.js';
import { sendResetEmail } from '../services/email.js';

// Compared against when the e-mail is unknown, so response time doesn't reveal which e-mails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

export default async function authRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;

  // ---------- SIGNUP (public → STUDENT accounts only) ----------
  // There is deliberately no `role` input. TPC officer / mentor / admin accounts are provisioned by an
  // ADMIN (POST /api/admin/users) or with `npm run user:create`.
  fastify.post('/signup', limit(5), async (req, reply) => {
    const body = parseOrThrow(signupSchema, req.body);

    const clash = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
    if (clash) return reply.code(409).send({ error: 'Email already registered' });
    const rollClash = await prisma.student.findUnique({ where: { rollNumber: body.rollNumber }, select: { id: true } });
    if (rollClash) return reply.code(409).send({ error: 'Roll number already registered' });

    const passwordHash = await bcrypt.hash(body.password, 12);
    // User + Student profile + skills row succeed or fail together. cgpa/backlogs start at 0 and are
    // entered by a TPC officer (they drive eligibility), so self-signup cannot grant eligibility.
    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        firstName: body.firstName,
        lastName: body.lastName,
        role: 'STUDENT',
        student: {
          create: { rollNumber: body.rollNumber, branch: body.branch, year: body.year, cgpa: 0, backlogs: 0, skills: { create: {} } },
        },
      },
      select: { id: true, email: true, role: true },
    });
    reply.code(201).send(user);
  });

  // ---------- LOGIN ----------
  fastify.post('/login', limit(10), async (req, reply) => {
    const body = parseOrThrow(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });

    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !ok) return reply.code(401).send({ error: 'Invalid email or password' });
    if (!user.isActive) return reply.code(403).send({ error: 'Account disabled' });

    const claims = { id: user.id, tv: user.tokenVersion };
    const token = signToken('access', claims, env.JWT_EXPIRES_IN);
    const refreshToken = signToken('refresh', claims, env.JWT_REFRESH_EXPIRES_IN);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    reply.send({
      token,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName },
    });
  });

  // ---------- REFRESH ----------
  fastify.post('/refresh', limit(30), async (req, reply) => {
    const { refreshToken } = parseOrThrow(refreshSchema, req.body);
    let payload;
    try {
      payload = verifyToken('refresh', refreshToken);
    } catch {
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }
    // Re-read the user so a disabled account / logout / password reset revokes refresh tokens too.
    const user = await prisma.user.findUnique({ where: { id: payload.id }, select: authUserSelect });
    if (!user || !user.isActive || user.tokenVersion !== payload.tv) {
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }
    reply.send({ token: signToken('access', { id: user.id, tv: user.tokenVersion }, env.JWT_EXPIRES_IN) });
  });

  // ---------- CURRENT USER ----------
  fastify.get('/me', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id, email, role, firstName, lastName } = req.currentUser!;
    reply.send({ id, email, role, firstName, lastName });
  });

  // ---------- LOGOUT (revokes every outstanding access + refresh token for this user) ----------
  fastify.post('/logout', { preHandler: fastify.authenticate }, async (req, reply) => {
    await prisma.user.update({ where: { id: req.currentUser!.id }, data: { tokenVersion: { increment: 1 } } });
    reply.send({ ok: true });
  });

  // ---------- PASSWORD RESET REQUEST ----------
  fastify.post('/request-reset', limit(5), async (req, reply) => {
    const { email } = parseOrThrow(requestResetSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    // Always 200 so the endpoint doesn't reveal which e-mails are registered.
    if (user && user.isActive) {
      const token = signToken('reset', { id: user.id, ph: passwordFingerprint(user.passwordHash) }, '1h');
      const url = `${env.APP_URL}/reset?token=${encodeURIComponent(token)}`;
      try {
        const sent = await sendResetEmail(user.email, url);
        if (!sent && !env.IS_PROD) req.log.info({ resetUrl: url }, 'e-mail not configured; dev-only reset link');
      } catch (err) {
        req.log.error(err);
      }
    }
    reply.send({ ok: true });
  });

  // ---------- PASSWORD RESET / SET-PASSWORD CONFIRM ----------
  fastify.post('/reset', limit(10), async (req, reply) => {
    const { token, newPassword } = parseOrThrow(resetSchema, req.body);
    let payload;
    try {
      payload = verifyToken('reset', token);
    } catch {
      return reply.code(401).send({ error: 'This link is invalid or has expired' });
    }
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    // The fingerprint changes as soon as the password changes, so a link works exactly once.
    if (!user || !user.isActive || payload.ph !== passwordFingerprint(user.passwordHash)) {
      return reply.code(401).send({ error: 'This link is invalid or has expired' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash, tokenVersion: { increment: 1 } } });
    reply.send({ ok: true });
  });
}
