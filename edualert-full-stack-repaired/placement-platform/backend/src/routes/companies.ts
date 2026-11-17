import { FastifyInstance } from 'fastify';
import { requireRole } from '../middlewares/rbac.js';
import { applicationStatusSchema, companyCreateSchema, companyUpdateSchema, idParam, parseOrThrow } from '../utils/validator.js';
import { checkEligibility } from '../lib/eligibility.js';
import { findStudentByUser } from '../lib/students.js';
import { publicUserSelect } from '../lib/serializers.js';
import { z } from 'zod';

const appIdParam = z.object({ appId: z.string().uuid() });

export default async function companyRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const officerOnly = { preHandler: [fastify.authenticate, requireRole('TPC_OFFICER', 'ADMIN')] };

  // List drives. Students additionally get server-computed eligibility + their own application status.
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const companies = await prisma.company.findMany({ orderBy: [{ driveDate: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }] });
    if (req.currentUser!.role !== 'STUDENT') return reply.send(companies);

    const me = await findStudentByUser(prisma, req.currentUser!.id);
    if (!me) return reply.send(companies);
    const apps = await prisma.application.findMany({ where: { studentId: me.id }, select: { id: true, companyId: true, status: true } });
    reply.send(
      companies.map((c) => ({
        ...c,
        eligibility: checkEligibility(me, c),
        myApplication: apps.find((a) => a.companyId === c.id) ?? null,
      }))
    );
  });

  fastify.post('/', officerOnly, async (req, reply) => {
    const data = parseOrThrow(companyCreateSchema, req.body);
    reply.code(201).send(await prisma.company.create({ data }));
  });

  fastify.patch('/:id', officerOnly, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    const data = parseOrThrow(companyUpdateSchema, req.body);
    reply.send(await prisma.company.update({ where: { id }, data }));
  });

  fastify.delete('/:id', officerOnly, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    await prisma.company.delete({ where: { id } }); // applications cascade; missing id → P2025 → 404
    reply.code(204).send();
  });

  // Drives the current student is eligible for
  fastify.get('/eligible', { preHandler: fastify.authenticate }, async (req, reply) => {
    const me = await findStudentByUser(prisma, req.currentUser!.id);
    if (!me) return reply.code(404).send({ error: 'Student profile not found' });
    const companies = await prisma.company.findMany({ where: { status: { in: ['OPEN', 'UPCOMING'] } }, orderBy: { driveDate: 'asc' } });
    reply.send(companies.filter((c) => checkEligibility(me, c).eligible));
  });

  // The current student's own applications
  fastify.get('/applications/mine', { preHandler: fastify.authenticate }, async (req, reply) => {
    const me = await findStudentByUser(prisma, req.currentUser!.id);
    if (!me) return reply.code(404).send({ error: 'Student profile not found' });
    reply.send(await prisma.application.findMany({ where: { studentId: me.id }, include: { company: true }, orderBy: { appliedAt: 'desc' } }));
  });

  // Student applies — eligibility and drive status are enforced on the server
  fastify.post('/:id/apply', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id: companyId } = parseOrThrow(idParam, req.params);
    const me = await findStudentByUser(prisma, req.currentUser!.id);
    if (!me) return reply.code(404).send({ error: 'Student profile not found' });
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return reply.code(404).send({ error: 'Company not found' });
    if (company.status === 'CLOSED') return reply.code(409).send({ error: 'Applications for this drive are closed' });

    const existing = await prisma.application.findUnique({ where: { studentId_companyId: { studentId: me.id, companyId } } });
    if (existing) return reply.send(existing);

    const elig = checkEligibility(me, company);
    if (!elig.eligible) return reply.code(403).send({ error: `Not eligible: ${elig.reasons.join('; ')}`, details: elig.reasons });
    reply.code(201).send(await prisma.application.create({ data: { studentId: me.id, companyId } }));
  });

  // Student withdraws an application that hasn't been actioned yet
  fastify.delete('/:id/apply', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id: companyId } = parseOrThrow(idParam, req.params);
    const me = await findStudentByUser(prisma, req.currentUser!.id);
    if (!me) return reply.code(404).send({ error: 'Student profile not found' });
    const app = await prisma.application.findUnique({ where: { studentId_companyId: { studentId: me.id, companyId } } });
    if (!app) return reply.code(404).send({ error: 'Application not found' });
    if (app.status !== 'APPLIED') return reply.code(409).send({ error: 'This application has already been processed' });
    await prisma.application.delete({ where: { id: app.id } });
    reply.code(204).send();
  });

  // Officer: applicant pipeline for a drive
  fastify.get('/:id/applications', officerOnly, async (req, reply) => {
    const { id: companyId } = parseOrThrow(idParam, req.params);
    reply.send(
      await prisma.application.findMany({
        where: { companyId },
        include: { student: { include: { user: { select: publicUserSelect } } } },
        orderBy: { appliedAt: 'desc' },
      })
    );
  });

  // Officer: move an applicant through the pipeline
  fastify.patch('/applications/:appId', officerOnly, async (req, reply) => {
    const { appId } = parseOrThrow(appIdParam, req.params);
    const { status } = parseOrThrow(applicationStatusSchema, req.body);
    reply.send(await prisma.application.update({ where: { id: appId }, data: { status } }));
  });
}
