import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../middlewares/rbac.js';
import {
  courseCreateSchema, courseListQuery, courseUpdateSchema, idParam, lessonCreateSchema, lessonProgressSchema,
  lessonUpdateSchema, parseOrThrow, quizAttemptSchema, quizCreateSchema,
} from '../utils/validator.js';
import { findStudentByUser } from '../lib/students.js';
import { env } from '../config/env.js';

const quizIdParam = z.object({ quizId: z.string().uuid() });
const lessonIdParam = z.object({ lessonId: z.string().uuid() });
const courseLessonParam = z.object({ id: z.string().uuid(), lessonId: z.string().uuid() });
const ACTIVITY_DEBOUNCE_MS = 5 * 60 * 1000;

export default async function courseRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const staff = { preHandler: [fastify.authenticate, requireRole('TPC_OFFICER', 'ADMIN', 'MENTOR')] };

  /** Officers/admins manage any course; a mentor only the courses they created. */
  async function loadManageableCourse(courseId: string, user: { id: string; role: string }) {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw Object.assign(new Error('Course not found'), { statusCode: 404 });
    if (user.role === 'MENTOR' && course.instructorId !== user.id) {
      throw Object.assign(new Error('You can only manage courses you created'), { statusCode: 403 });
    }
    return course;
  }

  // ---- list / filter ----
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { category, search } = parseOrThrow(courseListQuery, req.query);
    reply.send(
      await prisma.course.findMany({
        where: { ...(category ? { category } : {}), ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}) },
        include: { lessons: { orderBy: { orderIndex: 'asc' } } },
        orderBy: { title: 'asc' },
      })
    );
  });

  // ---- recommended: the categories where the student's skill % is lowest ----
  fastify.get('/recommended/me', { preHandler: fastify.authenticate }, async (req, reply) => {
    const me = await prisma.student.findUnique({ where: { userId: req.currentUser!.id }, include: { skills: true } });
    if (!me?.skills) return reply.send([]);
    const skillMap: Record<string, number> = {
      DSA: me.skills.dsaPct, APTITUDE: me.skills.aptitudePct, COMMUNICATION: me.skills.communicationPct, DOMAIN: me.skills.domainPct,
    };
    const weakest = Object.entries(skillMap).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([c]) => c) as ('DSA' | 'APTITUDE' | 'COMMUNICATION' | 'DOMAIN')[];
    reply.send(await prisma.course.findMany({ where: { category: { in: weakest } }, take: 6, orderBy: { title: 'asc' } }));
  });

  // ---- one course (lessons + quiz stubs; no answers) ----
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    const course = await prisma.course.findUnique({
      where: { id },
      include: { lessons: { orderBy: { orderIndex: 'asc' }, include: { quizzes: { select: { id: true, title: true } } } } },
    });
    if (!course) return reply.code(404).send({ error: 'Course not found' });
    reply.send(course);
  });

  // ---- my progress in a course (so the player can resume + show completion) ----
  fastify.get('/:id/progress', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    const me = await findStudentByUser(prisma, req.currentUser!.id);
    if (!me) return reply.send([]);
    reply.send(await prisma.lessonProgress.findMany({ where: { studentId: me.id, lesson: { courseId: id } } }));
  });

  // ---- course CMS ----
  fastify.post('/', staff, async (req, reply) => {
    const data = parseOrThrow(courseCreateSchema, req.body);
    reply.code(201).send(await prisma.course.create({ data: { ...data, instructorId: req.currentUser!.id }, include: { lessons: true } }));
  });

  fastify.patch('/:id', staff, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    const data = parseOrThrow(courseUpdateSchema, req.body);
    await loadManageableCourse(id, req.currentUser!);
    reply.send(await prisma.course.update({ where: { id }, data }));
  });

  fastify.delete('/:id', staff, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    await loadManageableCourse(id, req.currentUser!);
    await prisma.course.delete({ where: { id } }); // lessons, progress, quizzes, certificates cascade
    reply.code(204).send();
  });

  fastify.post('/:id/lessons', staff, async (req, reply) => {
    const { id: courseId } = parseOrThrow(idParam, req.params);
    const body = parseOrThrow(lessonCreateSchema, req.body);
    await loadManageableCourse(courseId, req.currentUser!);

    const lesson = await prisma.$transaction(async (tx) => {
      const last = await tx.lesson.aggregate({ where: { courseId }, _max: { orderIndex: true } });
      const l = await tx.lesson.create({ data: { ...body, orderIndex: body.orderIndex ?? (last._max.orderIndex ?? 0) + 1, courseId } });
      await tx.course.update({ where: { id: courseId }, data: { totalLessons: await tx.lesson.count({ where: { courseId } }) } });
      return l;
    });
    reply.code(201).send(lesson);
  });

  fastify.patch('/:id/lessons/:lessonId', staff, async (req, reply) => {
    const { id: courseId, lessonId } = parseOrThrow(courseLessonParam, req.params);
    const data = parseOrThrow(lessonUpdateSchema, req.body);
    await loadManageableCourse(courseId, req.currentUser!);
    const l = await prisma.lesson.findFirst({ where: { id: lessonId, courseId }, select: { id: true } });
    if (!l) return reply.code(404).send({ error: 'Lesson not found' });
    reply.send(await prisma.lesson.update({ where: { id: lessonId }, data }));
  });

  fastify.delete('/:id/lessons/:lessonId', staff, async (req, reply) => {
    const { id: courseId, lessonId } = parseOrThrow(courseLessonParam, req.params);
    await loadManageableCourse(courseId, req.currentUser!);
    const l = await prisma.lesson.findFirst({ where: { id: lessonId, courseId }, select: { id: true } });
    if (!l) return reply.code(404).send({ error: 'Lesson not found' });
    await prisma.$transaction(async (tx) => {
      await tx.lesson.delete({ where: { id: lessonId } });
      await tx.course.update({ where: { id: courseId }, data: { totalLessons: await tx.lesson.count({ where: { courseId } }) } });
    });
    reply.code(204).send();
  });

  fastify.post('/lessons/:lessonId/quizzes', staff, async (req, reply) => {
    const { lessonId } = parseOrThrow(lessonIdParam, req.params);
    const body = parseOrThrow(quizCreateSchema, req.body);
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { id: true, courseId: true } });
    if (!lesson) return reply.code(404).send({ error: 'Lesson not found' });
    await loadManageableCourse(lesson.courseId, req.currentUser!);
    const quiz = await prisma.$transaction(async (tx) => {
      const q = await tx.quiz.create({ data: { lessonId, title: body.title, questions: { create: body.questions } }, select: { id: true, title: true } });
      await tx.lesson.update({ where: { id: lessonId }, data: { hasQuiz: true } });
      return q;
    });
    reply.code(201).send(quiz);
  });

  // ---- take a quiz: questions WITHOUT the answer key ----
  fastify.get('/quizzes/:quizId', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { quizId } = parseOrThrow(quizIdParam, req.params);
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      select: { id: true, title: true, lessonId: true, questions: { select: { id: true, text: true, options: true } } },
    });
    if (!quiz) return reply.code(404).send({ error: 'Quiz not found' });
    reply.send(quiz);
  });

  // ---- report watched seconds (resume-where-you-left-off) ----
  fastify.post('/lesson-progress', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { lessonId, watchedSeconds } = parseOrThrow(lessonProgressSchema, req.body);
    const me = await findStudentByUser(prisma, req.currentUser!.id);
    if (!me) return reply.code(404).send({ error: 'Student profile not found' });
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { durationSeconds: true } });
    if (!lesson) return reply.code(404).send({ error: 'Lesson not found' });

    const seconds = Math.min(watchedSeconds, lesson.durationSeconds); // a client can't claim more than the video length
    const completedNow = seconds >= lesson.durationSeconds * 0.95;
    const progress = await prisma.lessonProgress.upsert({
      where: { studentId_lessonId: { studentId: me.id, lessonId } },
      create: { studentId: me.id, lessonId, watchedSeconds: seconds, completedAt: completedNow ? new Date() : null },
      update: { watchedSeconds: seconds, ...(completedNow ? { completedAt: new Date() } : {}) },
    });

    // Progress pings arrive every few seconds; log engagement at most once per window.
    const recent = await prisma.activityLog.findFirst({
      where: { studentId: me.id, eventType: 'LECTURE_WATCHED', occurredAt: { gt: new Date(Date.now() - ACTIVITY_DEBOUNCE_MS) } },
      select: { id: true },
    });
    if (!recent) await prisma.activityLog.create({ data: { studentId: me.id, eventType: 'LECTURE_WATCHED' } });
    reply.send(progress);
  });

  // ---- auto-graded quiz attempt ----
  fastify.post('/quiz-attempt', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { quizId, answers } = parseOrThrow(quizAttemptSchema, req.body);
    const me = await findStudentByUser(prisma, req.currentUser!.id);
    if (!me) return reply.code(404).send({ error: 'Student profile not found' });
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, include: { questions: true } });
    if (!quiz) return reply.code(404).send({ error: 'Quiz not found' });

    // One answer per question: repeating a correct answer must not inflate the score.
    const chosen = new Map(answers.map((a) => [a.questionId, a.chosenIndex]));
    let correct = 0;
    for (const q of quiz.questions) if (chosen.get(q.id) === q.correctOption) correct += 1;
    const score = quiz.questions.length ? (correct / quiz.questions.length) * 100 : 0;

    const attempt = await prisma.$transaction(async (tx) => {
      const a = await tx.quizAttempt.create({ data: { quizId, studentId: me.id, score } });
      await tx.activityLog.create({ data: { studentId: me.id, eventType: 'QUIZ_ATTEMPTED' } });
      return a;
    });
    reply.send({ ...attempt, correct, total: quiz.questions.length });
  });

  // ---- certificate once every lesson is complete ----
  fastify.post('/:id/certificate', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id: courseId } = parseOrThrow(idParam, req.params);
    const me = await findStudentByUser(prisma, req.currentUser!.id);
    if (!me) return reply.code(404).send({ error: 'Student profile not found' });
    const lessons = await prisma.lesson.findMany({ where: { courseId }, select: { id: true } });
    const done = await prisma.lessonProgress.findMany({
      where: { studentId: me.id, lessonId: { in: lessons.map((l) => l.id) }, completedAt: { not: null } },
      select: { lessonId: true },
    });
    if (lessons.length === 0 || done.length < lessons.length) return reply.code(400).send({ error: 'Course not yet fully completed' });

    // TODO (see README): render a real PDF and upload it; until then the URL is derived from CERTIFICATE_BASE_URL.
    const base = env.CERTIFICATE_BASE_URL.replace(/\/$/, '');
    const certificateUrl = `${base}/certificates/${me.id}-${courseId}.pdf`;
    reply.send(
      await prisma.certificate.upsert({
        where: { studentId_courseId: { studentId: me.id, courseId } },
        update: {},
        create: { studentId: me.id, courseId, certificateUrl },
      })
    );
  });
}
