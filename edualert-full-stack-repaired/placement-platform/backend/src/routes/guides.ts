import { FastifyInstance } from 'fastify';
import { requireRole } from '../middlewares/rbac.js';
import { guideCreateSchema, guideListQuery, guideUpdateSchema, idParam, parseOrThrow } from '../utils/validator.js';

export default async function guideRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const staffOnly = { preHandler: [fastify.authenticate, requireRole('TPC_OFFICER', 'ADMIN')] };
  const include = { company: { select: { id: true, name: true } } };
  const isStaff = (role: string) => role === 'TPC_OFFICER' || role === 'ADMIN';

  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const q = parseOrThrow(guideListQuery, req.query);
    const where = {
      ...(isStaff(req.currentUser!.role) ? {} : { published: true }),
      ...(q.category ? { category: q.category } : {}),
      ...(q.search
        ? { OR: [{ title: { contains: q.search, mode: 'insensitive' as const } }, { summary: { contains: q.search, mode: 'insensitive' as const } }] }
        : {}),
    };
    reply.send(await prisma.prepGuide.findMany({ where, include, orderBy: [{ category: 'asc' }, { title: 'asc' }, { id: 'asc' }], take: 200 }));
  });

  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    const guide = await prisma.prepGuide.findUnique({ where: { id }, include });
    // Drafts are invisible (404, not 403) to non-staff so their existence isn't revealed.
    if (!guide || (!guide.published && !isStaff(req.currentUser!.role))) return reply.code(404).send({ error: 'Guide not found' });
    reply.send(guide);
  });

  fastify.post('/', staffOnly, async (req, reply) => {
    const data = parseOrThrow(guideCreateSchema, req.body);
    reply.code(201).send(await prisma.prepGuide.create({ data, include })); // unknown companyId → P2003 → 409
  });

  fastify.patch('/:id', staffOnly, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    reply.send(await prisma.prepGuide.update({ where: { id }, data: parseOrThrow(guideUpdateSchema, req.body), include }));
  });

  fastify.delete('/:id', staffOnly, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    await prisma.prepGuide.delete({ where: { id } });
    reply.code(204).send();
  });
}
