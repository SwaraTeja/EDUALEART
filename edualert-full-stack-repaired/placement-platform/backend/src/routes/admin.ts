import { FastifyInstance } from 'fastify';
import { requireRole } from '../middlewares/rbac.js';
import { adminCreateUserSchema, adminUpdateUserSchema, idParam, parseOrThrow } from '../utils/validator.js';
import { provisionSetPasswordLink } from '../lib/provision.js';

/**
 * Privileged-account provisioning. This is the ONLY HTTP path that can create TPC_OFFICER / MENTOR / ADMIN
 * users, and it is ADMIN-only. The first ADMIN is bootstrapped out-of-band with `npm run user:create`.
 */
export default async function adminRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const adminOnly = { preHandler: [fastify.authenticate, requireRole('ADMIN')] };

  fastify.get('/users', adminOnly, async (_req, reply) => {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, createdAt: true, lastLoginAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    reply.send(users);
  });

  fastify.post('/users', adminOnly, async (req, reply) => {
    const body = parseOrThrow(adminCreateUserSchema, req.body);
    const exists = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
    if (exists) return reply.code(409).send({ error: 'Email already registered' });

    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: body.email,
          firstName: body.firstName,
          lastName: body.lastName,
          role: body.role,
          ...(body.role === 'MENTOR'
            ? { mentor: { create: { specialty: body.specialty, bio: body.bio, experienceYears: body.experienceYears } } }
            : {}),
        },
        select: { id: true, email: true, firstName: true, lastName: true, role: true, passwordHash: true },
      });
      await tx.auditLog.create({
        data: { actorId: req.currentUser!.id, action: `PROVISION_${body.role}`, targetTable: 'User', targetId: u.id },
      });
      return u;
    });

    const link = await provisionSetPasswordLink(user, req.log);
    const { passwordHash: _omit, ...safe } = user;
    reply.code(201).send({ ...safe, ...link });
  });

  // Enable / disable an account. Disabling bumps tokenVersion so existing sessions die immediately.
  fastify.patch('/users/:id', adminOnly, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    const { isActive } = parseOrThrow(adminUpdateUserSchema, req.body);
    if (id === req.currentUser!.id && !isActive) return reply.code(400).send({ error: 'You cannot disable your own account' });

    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { isActive, ...(isActive ? {} : { tokenVersion: { increment: 1 } }) },
        select: { id: true, email: true, role: true, isActive: true },
      });
      await tx.auditLog.create({
        data: { actorId: req.currentUser!.id, action: isActive ? 'ENABLE_USER' : 'DISABLE_USER', targetTable: 'User', targetId: id },
      });
      return u;
    });
    reply.send(user);
  });
}
