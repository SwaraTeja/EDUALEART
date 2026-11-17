import { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { requireRole } from '../middlewares/rbac.js';
import {
  idParam, parseOrThrow, studentBulkSchema, studentCreateSchema, studentListQuery,
  studentOfficerUpdateSchema, studentSelfUpdateSchema, studentSkillsSchema,
} from '../utils/validator.js';
import { publicUserSelect } from '../lib/serializers.js';
import { findStudentByUser, mentorHasStudent, studentInclude } from '../lib/students.js';
import { provisionSetPasswordLink } from '../lib/provision.js';
import { recordScore } from '../services/risk-scoring.js';

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const RESUME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export default async function studentRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  await fastify.register(multipart, { limits: { fileSize: MAX_RESUME_BYTES, files: 1 } });
  const officerOnly = { preHandler: [fastify.authenticate, requireRole('TPC_OFFICER', 'ADMIN')] };

  /** Rejects with 409 naming the clashing field, before the DB unique index would produce a 500-ish error. */
  async function assertUnique(email?: string, rollNumber?: string, exceptStudentId?: string) {
    if (email) {
      const u = await prisma.user.findUnique({ where: { email }, select: { id: true, student: { select: { id: true } } } });
      if (u && u.student?.id !== exceptStudentId) throw Object.assign(new Error('A user with this email already exists'), { statusCode: 409 });
    }
    if (rollNumber) {
      const s = await prisma.student.findUnique({ where: { rollNumber }, select: { id: true } });
      if (s && s.id !== exceptStudentId) throw Object.assign(new Error('A student with this roll number already exists'), { statusCode: 409 });
    }
  }

  // ---- GET own profile (any logged-in student) ----
  fastify.get('/me', { preHandler: fastify.authenticate }, async (req, reply) => {
    const student = await prisma.student.findUnique({
      where: { userId: req.currentUser!.id },
      include: { ...studentInclude, scores: { orderBy: { recordedAt: 'desc' }, take: 10 } },
    });
    if (!student) return reply.code(404).send({ error: 'Student profile not found' });
    reply.send(student);
  });

  // ---- PATCH own contact details (phone / LinkedIn only) ----
  fastify.patch('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const data = parseOrThrow(studentSelfUpdateSchema, req.body);
    const me = await findStudentByUser(prisma, req.currentUser!.id);
    if (!me) return reply.code(404).send({ error: 'Student profile not found' });
    reply.send(await prisma.student.update({ where: { id: me.id }, data, include: studentInclude }));
  });

  // ---- LIST (officer/admin) — paginated, server-side filters ----
  fastify.get('/', officerOnly, async (req, reply) => {
    const q = parseOrThrow(studentListQuery, req.query);
    const where: Prisma.StudentWhereInput = {};
    if (q.branch) where.branch = q.branch;
    if (q.search) {
      where.OR = [
        { rollNumber: { contains: q.search, mode: 'insensitive' } },
        { user: { firstName: { contains: q.search, mode: 'insensitive' } } },
        { user: { lastName: { contains: q.search, mode: 'insensitive' } } },
        { user: { email: { contains: q.search, mode: 'insensitive' } } },
      ];
    }
    if (q.riskLevel) {
      // Filter on each student's LATEST score, in SQL, so pagination and totals stay correct.
      const rows = await prisma.$queryRaw<{ studentId: string }[]>(Prisma.sql`
        SELECT t."studentId" FROM (
          SELECT DISTINCT ON ("studentId") "studentId", "riskLevel"
          FROM "StudentScore" ORDER BY "studentId", "recordedAt" DESC
        ) t WHERE t."riskLevel" = ${q.riskLevel}::"RiskLevel"`);
      where.id = { in: rows.map((r) => r.studentId) };
    }

    const [total, students] = await Promise.all([
      prisma.student.count({ where }),
      prisma.student.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { ...studentInclude, scores: { orderBy: { recordedAt: 'desc' }, take: 1 } },
        orderBy: { rollNumber: 'asc' },
      }),
    ]);
    reply.header('X-Total-Count', String(total)).send(students);
  });

  // ---- CREATE (officer/admin) ----
  fastify.post('/', officerOnly, async (req, reply) => {
    const body = parseOrThrow(studentCreateSchema, req.body);
    await assertUnique(body.email, body.rollNumber);

    const created = await prisma.$transaction(async (tx) => {
      const student = await tx.student.create({
        data: {
          rollNumber: body.rollNumber, branch: body.branch, year: body.year, cgpa: body.cgpa, backlogs: body.backlogs,
          tenthPct: body.tenthPct, twelfthPct: body.twelfthPct, phone: body.phone, linkedinUrl: body.linkedinUrl,
          user: { create: { email: body.email, firstName: body.firstName, lastName: body.lastName, role: 'STUDENT' } },
          skills: { create: {} },
        },
        include: { user: { select: { ...publicUserSelect, passwordHash: true } } },
      });
      await tx.auditLog.create({ data: { actorId: req.currentUser!.id, action: 'CREATE_STUDENT', targetTable: 'Student', targetId: student.id } });
      await recordScore(tx, student.id);
      return student;
    });

    const link = await provisionSetPasswordLink({ ...created.user, passwordHash: created.user.passwordHash }, req.log);
    const { passwordHash: _omit, ...safeUser } = created.user;
    reply.code(201).send({ ...created, user: safeUser, ...link });
  });

  // ---- BULK CREATE (officer/admin) — all-or-nothing ----
  fastify.post('/bulk', officerOnly, async (req, reply) => {
    const rows = parseOrThrow(studentBulkSchema, req.body);
    const dupEmail = rows.find((r, i) => rows.findIndex((x) => x.email === r.email) !== i);
    const dupRoll = rows.find((r, i) => rows.findIndex((x) => x.rollNumber === r.rollNumber) !== i);
    if (dupEmail || dupRoll) {
      return reply.code(409).send({ error: `Duplicate ${dupEmail ? `email ${dupEmail.email}` : `roll number ${dupRoll!.rollNumber}`} within the upload` });
    }
    const [users, studs] = await Promise.all([
      prisma.user.findMany({ where: { email: { in: rows.map((r) => r.email) } }, select: { email: true } }),
      prisma.student.findMany({ where: { rollNumber: { in: rows.map((r) => r.rollNumber) } }, select: { rollNumber: true } }),
    ]);
    if (users.length || studs.length) {
      return reply.code(409).send({
        error: 'Some records already exist; nothing was imported',
        details: { emails: users.map((u) => u.email), rollNumbers: studs.map((s) => s.rollNumber) },
      });
    }

    const ids = await prisma.$transaction(
      async (tx) => {
        const out: string[] = [];
        for (const row of rows) {
          const s = await tx.student.create({
            data: {
              rollNumber: row.rollNumber, branch: row.branch, year: row.year, cgpa: row.cgpa, backlogs: row.backlogs,
              tenthPct: row.tenthPct, twelfthPct: row.twelfthPct, phone: row.phone, linkedinUrl: row.linkedinUrl,
              user: { create: { email: row.email, firstName: row.firstName, lastName: row.lastName, role: 'STUDENT' } },
              skills: { create: {} },
            },
            select: { id: true },
          });
          await recordScore(tx, s.id);
          out.push(s.id);
        }
        await tx.auditLog.create({ data: { actorId: req.currentUser!.id, action: `BULK_CREATE_STUDENTS:${out.length}`, targetTable: 'Student' } });
        return out;
      },
      { timeout: 30_000 }
    );
    reply.code(201).send({ createdCount: ids.length });
  });

  // ---- RESUME upload (students only) ----
  fastify.post('/resume', { preHandler: fastify.authenticate }, async (req, reply) => {
    if (!fastify.s3 || !env.S3_BUCKET) return reply.code(503).send({ error: 'Resume storage is not configured' });
    const me = await findStudentByUser(prisma, req.currentUser!.id);
    if (!me) return reply.code(404).send({ error: 'Student profile not found' });

    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No file uploaded' });
    if (!RESUME_TYPES.has(file.mimetype)) return reply.code(415).send({ error: 'Resume must be a PDF or Word document' });
    const body = await file.toBuffer(); // throws 413 beyond MAX_RESUME_BYTES
    const safeName = file.filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'resume';
    const key = `resumes/${req.currentUser!.id}/${Date.now()}_${safeName}`;

    await fastify.s3.upload({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: file.mimetype }).promise();
    const url = env.S3_PUBLIC_URL ? `${env.S3_PUBLIC_URL}/${key}` : key;
    const updated = await prisma.student.update({ where: { id: me.id }, data: { resumeUrl: url }, select: { resumeUrl: true } });
    reply.send(updated);
  });

  // ---- GET one ----
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    const user = req.currentUser!;

    const include = {
      ...studentInclude,
      scores: { orderBy: { recordedAt: 'desc' as const }, take: 30 },
      applications: { include: { company: true } },
      alerts: { orderBy: { createdAt: 'desc' as const }, take: 10 },
    };
    const student = await prisma.student.findUnique({ where: { id }, include });
    if (!student) return reply.code(404).send({ error: 'Student not found' });

    if (user.role === 'TPC_OFFICER' || user.role === 'ADMIN') return reply.send(student);
    if (user.role === 'STUDENT' && student.userId === user.id) return reply.send(student);
    if (user.role === 'MENTOR' && (await mentorHasStudent(prisma, user.id, id))) {
      // Mentors see academic/skill context for their own mentees only — no contact details, no alerts.
      const { phone, linkedinUrl, resumeUrl, alerts, user: u, ...rest } = student;
      return reply.send({ ...rest, user: { id: u.id, firstName: u.firstName, lastName: u.lastName } });
    }
    return reply.code(403).send({ error: 'Insufficient privileges' });
  });

  // ---- UPDATE (officer/admin) ----
  fastify.patch('/:id', officerOnly, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    const { firstName, lastName, ...fields } = parseOrThrow(studentOfficerUpdateSchema, req.body);
    const existing = await prisma.student.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!existing) return reply.code(404).send({ error: 'Student not found' });
    if (fields.rollNumber) await assertUnique(undefined, fields.rollNumber, id);

    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.student.update({
        where: { id },
        data: { ...fields, ...(firstName || lastName ? { user: { update: { firstName, lastName } } } : {}) },
        include: studentInclude,
      });
      await tx.auditLog.create({ data: { actorId: req.currentUser!.id, action: 'UPDATE_STUDENT', targetTable: 'Student', targetId: id } });
      // Academic changes alter the placement score — record a fresh point immediately.
      if ('cgpa' in fields || 'backlogs' in fields) await recordScore(tx, id);
      return s;
    });
    reply.send(updated);
  });

  // ---- UPDATE skills (officer/admin) ----
  fastify.put('/:id/skills', officerOnly, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    const data = parseOrThrow(studentSkillsSchema, req.body);
    const exists = await prisma.student.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return reply.code(404).send({ error: 'Student not found' });
    const skills = await prisma.$transaction(async (tx) => {
      const s = await tx.studentSkill.upsert({ where: { studentId: id }, create: { studentId: id, ...data }, update: { ...data, lastUpdated: new Date() } });
      await tx.auditLog.create({ data: { actorId: req.currentUser!.id, action: 'UPDATE_STUDENT_SKILLS', targetTable: 'StudentSkill', targetId: id } });
      await recordScore(tx, id);
      return s;
    });
    reply.send(skills);
  });

  // ---- DELETE (officer/admin) ----
  fastify.delete('/:id', officerOnly, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    const student = await prisma.student.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!student) return reply.code(404).send({ error: 'Student not found' });

    await prisma.$transaction(async (tx) => {
      // Free any mentor slots this student held, then delete the user — FK cascades remove the student
      // profile, skills, scores, activity, applications, progress, attempts, certificates, alerts and bookings.
      await tx.mentorSlot.updateMany({ where: { booking: { studentId: id }, status: 'BOOKED' }, data: { status: 'AVAILABLE' } });
      await tx.user.delete({ where: { id: student.userId } });
      await tx.auditLog.create({ data: { actorId: req.currentUser!.id, action: 'DELETE_STUDENT', targetTable: 'Student', targetId: id } });
    });
    reply.code(204).send();
  });
}
