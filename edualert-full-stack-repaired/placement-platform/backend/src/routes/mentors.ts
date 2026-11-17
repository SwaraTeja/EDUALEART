import { FastifyInstance } from 'fastify';
import { requireRole } from '../middlewares/rbac.js';
import { mentorUpdateSchema, parseOrThrow } from '../utils/validator.js';
import { nameOnlyUserSelect } from '../lib/serializers.js';

export default async function mentorRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;

  fastify.get('/', { preHandler: fastify.authenticate }, async (_req, reply) => {
    reply.send(
      await prisma.mentor.findMany({
        include: { user: { select: nameOnlyUserSelect } },
        orderBy: [{ rating: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      })
    );
  });

  fastify.get('/me', { preHandler: [fastify.authenticate, requireRole('MENTOR')] }, async (req, reply) => {
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.currentUser!.id }, include: { user: { select: nameOnlyUserSelect } } });
    if (!mentor) return reply.code(404).send({ error: 'Mentor profile not found' });
    reply.send(mentor);
  });

  // A mentor edits ONLY their own descriptive fields — never rating, sessionsCompleted or ownership.
  fastify.patch('/me', { preHandler: [fastify.authenticate, requireRole('MENTOR')] }, async (req, reply) => {
    const data = parseOrThrow(mentorUpdateSchema, req.body);
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.currentUser!.id }, select: { id: true } });
    if (!mentor) return reply.code(404).send({ error: 'Mentor profile not found' });
    reply.send(await prisma.mentor.update({ where: { id: mentor.id }, data }));
  });
}
