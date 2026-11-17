import { FastifyInstance } from 'fastify';
import { requireRole } from '../middlewares/rbac.js';
import { announcementCreateSchema, announcementUpdateSchema, idParam, parseOrThrow } from '../utils/validator.js';
import { nameOnlyUserSelect } from '../lib/serializers.js';

export default async function announcementRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const officerOnly = { preHandler: [fastify.authenticate, requireRole('TPC_OFFICER', 'ADMIN')] };
  const include = { postedBy: { select: nameOnlyUserSelect } };

  fastify.get('/', { preHandler: fastify.authenticate }, async (_req, reply) => {
    reply.send(await prisma.announcement.findMany({ include, orderBy: [{ pinned: 'desc' }, { postedAt: 'desc' }], take: 100 }));
  });

  fastify.post('/', officerOnly, async (req, reply) => {
    const data = parseOrThrow(announcementCreateSchema, req.body);
    reply.code(201).send(await prisma.announcement.create({ data: { ...data, postedById: req.currentUser!.id }, include }));
  });

  fastify.patch('/:id', officerOnly, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    reply.send(await prisma.announcement.update({ where: { id }, data: parseOrThrow(announcementUpdateSchema, req.body), include }));
  });

  fastify.delete('/:id', officerOnly, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    await prisma.announcement.delete({ where: { id } });
    reply.code(204).send();
  });
}
