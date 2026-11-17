import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { requireRole } from '../middlewares/rbac.js';
import { alertCreateSchema, alertListQuery, idParam, parseOrThrow } from '../utils/validator.js';
import { nameOnlyUserSelect } from '../lib/serializers.js';
import { findStudentByUser } from '../lib/students.js';

export default async function alertRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const officerOnly = { preHandler: [fastify.authenticate, requireRole('TPC_OFFICER', 'ADMIN')] };

  // Officers see every alert; a student sees only their own.
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const q = parseOrThrow(alertListQuery, req.query);
    const user = req.currentUser!;
    const where: Prisma.AlertWhereInput = {
      ...(q.level ? { level: q.level } : {}),
      ...(q.resolved ? { resolvedAt: q.resolved === 'true' ? { not: null } : null } : {}),
    };
    if (user.role === 'STUDENT') {
      const me = await findStudentByUser(prisma, user.id);
      if (!me) return reply.send([]);
      where.studentId = me.id;
    } else if (user.role !== 'TPC_OFFICER' && user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Insufficient privileges' });
    }
    reply.send(
      await prisma.alert.findMany({
        where,
        include: { student: { select: { id: true, rollNumber: true, branch: true, user: { select: nameOnlyUserSelect } } } },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
      })
    );
  });

  fastify.post('/', officerOnly, async (req, reply) => {
    const data = parseOrThrow(alertCreateSchema, req.body);
    const exists = await prisma.student.findUnique({ where: { id: data.studentId }, select: { id: true } });
    if (!exists) return reply.code(404).send({ error: 'Student not found' });
    reply.code(201).send(await prisma.alert.create({ data }));
  });

  fastify.patch('/:id/resolve', officerOnly, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    const alert = await prisma.alert.findUnique({ where: { id }, select: { resolvedAt: true } });
    if (!alert) return reply.code(404).send({ error: 'Alert not found' });
    if (alert.resolvedAt) return reply.send(await prisma.alert.findUnique({ where: { id } }));
    reply.send(await prisma.alert.update({ where: { id }, data: { resolvedAt: new Date() } }));
  });
}
