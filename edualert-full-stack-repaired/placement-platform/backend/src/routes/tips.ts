import { FastifyInstance } from 'fastify';
import { requireRole } from '../middlewares/rbac.js';
import { idParam, parseOrThrow, tipCreateSchema, tipUpdateSchema } from '../utils/validator.js';
import { findStudentByUser } from '../lib/students.js';
import { matchTips } from '../lib/tips.js';

export default async function tipRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const staffOnly = { preHandler: [fastify.authenticate, requireRole('TPC_OFFICER', 'ADMIN')] };
  const studentOnly = { preHandler: [fastify.authenticate, requireRole('STUDENT')] };

  // The current student's personalised tips & actions: active tips whose category score is below the tip's threshold.
  fastify.get('/me', studentOnly, async (req, reply) => {
    const me = await findStudentByUser(prisma, req.currentUser!.id);
    if (!me) return reply.code(404).send({ error: 'Student profile not found' });
    const skills = await prisma.studentSkill.findUnique({ where: { studentId: me.id } });
    const tips = await prisma.tip.findMany({ where: { isActive: true } });
    reply.send({
      skills: skills
        ? {
            dsaPct: skills.dsaPct, aptitudePct: skills.aptitudePct, communicationPct: skills.communicationPct,
            domainPct: skills.domainPct, mockInterviewPct: skills.mockInterviewPct,
          }
        : null,
      tips: matchTips(tips, skills),
    });
  });

  // Content management (all tips, including inactive).
  fastify.get('/', staffOnly, async (_req, reply) => {
    reply.send(await prisma.tip.findMany({ orderBy: [{ category: 'asc' }, { title: 'asc' }, { id: 'asc' }], take: 500 }));
  });

  fastify.post('/', staffOnly, async (req, reply) => {
    reply.code(201).send(await prisma.tip.create({ data: parseOrThrow(tipCreateSchema, req.body) }));
  });

  fastify.patch('/:id', staffOnly, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    reply.send(await prisma.tip.update({ where: { id }, data: parseOrThrow(tipUpdateSchema, req.body) }));
  });

  fastify.delete('/:id', staffOnly, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    await prisma.tip.delete({ where: { id } });
    reply.code(204).send();
  });
}
