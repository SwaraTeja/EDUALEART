import { FastifyInstance } from 'fastify';
import { requireRole } from '../middlewares/rbac.js';
import {
  idParam, parseOrThrow, roadmapCreateSchema, roadmapStepCreateSchema, roadmapStepUpdateSchema, roadmapUpdateSchema, stepIdParam,
} from '../utils/validator.js';
import { findStudentByUser } from '../lib/students.js';

export default async function roadmapRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const staffOnly = { preHandler: [fastify.authenticate, requireRole('TPC_OFFICER', 'ADMIN')] };
  const studentOnly = { preHandler: [fastify.authenticate, requireRole('STUDENT')] };
  const stepOrder = [{ orderIndex: 'asc' as const }, { id: 'asc' as const }];

  // Roadmaps with ordered steps. Staff see drafts too; everyone else sees published roadmaps only.
  // Students additionally get per-step `done` flags and an overall `progressPct` from their own progress.
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const user = req.currentUser!;
    const isStaff = user.role === 'TPC_OFFICER' || user.role === 'ADMIN';
    const roadmaps = await prisma.roadmap.findMany({
      where: isStaff ? {} : { published: true },
      include: { steps: { orderBy: stepOrder } },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    });

    const done = new Set<string>();
    if (user.role === 'STUDENT') {
      const me = await findStudentByUser(prisma, user.id);
      if (me) {
        const rows = await prisma.roadmapProgress.findMany({ where: { studentId: me.id }, select: { stepId: true } });
        rows.forEach((r) => done.add(r.stepId));
      }
    }

    reply.send(
      roadmaps.map((r) => {
        const steps = r.steps.map((s) => ({ ...s, done: done.has(s.id) }));
        const completed = steps.filter((s) => s.done).length;
        return { ...r, steps, progressPct: steps.length ? Math.round((completed / steps.length) * 100) : 0 };
      })
    );
  });

  fastify.post('/', staffOnly, async (req, reply) => {
    const data = parseOrThrow(roadmapCreateSchema, req.body);
    reply.code(201).send(await prisma.roadmap.create({ data, include: { steps: true } }));
  });

  fastify.patch('/:id', staffOnly, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    const data = parseOrThrow(roadmapUpdateSchema, req.body);
    reply.send(await prisma.roadmap.update({ where: { id }, data, include: { steps: { orderBy: stepOrder } } }));
  });

  fastify.delete('/:id', staffOnly, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    await prisma.roadmap.delete({ where: { id } }); // steps + progress cascade; missing id → P2025 → 404
    reply.code(204).send();
  });

  // ---- steps ----
  fastify.post('/:id/steps', staffOnly, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    const data = parseOrThrow(roadmapStepCreateSchema, req.body);
    const roadmap = await prisma.roadmap.findUnique({ where: { id }, select: { id: true } });
    if (!roadmap) return reply.code(404).send({ error: 'Roadmap not found' });
    let orderIndex = data.orderIndex;
    if (orderIndex === undefined) {
      const last = await prisma.roadmapStep.aggregate({ where: { roadmapId: id }, _max: { orderIndex: true } });
      orderIndex = (last._max.orderIndex ?? -1) + 1;
    }
    reply.code(201).send(await prisma.roadmapStep.create({ data: { ...data, orderIndex, roadmapId: id } }));
  });

  fastify.patch('/steps/:stepId', staffOnly, async (req, reply) => {
    const { stepId } = parseOrThrow(stepIdParam, req.params);
    const data = parseOrThrow(roadmapStepUpdateSchema, req.body);
    reply.send(await prisma.roadmapStep.update({ where: { id: stepId }, data }));
  });

  fastify.delete('/steps/:stepId', staffOnly, async (req, reply) => {
    const { stepId } = parseOrThrow(stepIdParam, req.params);
    await prisma.roadmapStep.delete({ where: { id: stepId } });
    reply.code(204).send();
  });

  // ---- a student's own progress (ownership is implicit: always the caller's student record) ----
  fastify.post('/steps/:stepId/complete', studentOnly, async (req, reply) => {
    const { stepId } = parseOrThrow(stepIdParam, req.params);
    const me = await findStudentByUser(prisma, req.currentUser!.id);
    if (!me) return reply.code(404).send({ error: 'Student profile not found' });
    const step = await prisma.roadmapStep.findFirst({ where: { id: stepId, roadmap: { published: true } }, select: { id: true } });
    if (!step) return reply.code(404).send({ error: 'Step not found' });
    await prisma.roadmapProgress.upsert({
      where: { studentId_stepId: { studentId: me.id, stepId } },
      update: {},
      create: { studentId: me.id, stepId },
    });
    reply.send({ stepId, done: true });
  });

  fastify.delete('/steps/:stepId/complete', studentOnly, async (req, reply) => {
    const { stepId } = parseOrThrow(stepIdParam, req.params);
    const me = await findStudentByUser(prisma, req.currentUser!.id);
    if (!me) return reply.code(404).send({ error: 'Student profile not found' });
    await prisma.roadmapProgress.deleteMany({ where: { studentId: me.id, stepId } });
    reply.send({ stepId, done: false });
  });
}
