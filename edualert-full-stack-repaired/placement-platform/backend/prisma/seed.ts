/**
 * Seed script — loads demo data (officer, mentor, students, drives, a course with a quiz, announcements)
 * into the database. Safe to run repeatedly: every record is upserted / looked up by a natural key, so a
 * second run creates no duplicates.
 *
 * Run with:  npm run db:seed          (or: npx tsx prisma/seed.ts)
 *
 * Demo passwords come from SEED_OFFICER_PASSWORD / SEED_STUDENT_PASSWORD / SEED_MENTOR_PASSWORD
 * (defaults are for local development only). The seed REFUSES to run when NODE_ENV=production unless
 * SEED_ALLOW_PRODUCTION=true, so demo accounts can't be created in production by accident.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import { recordScore } from '../src/services/risk-scoring.js';

export async function runSeed(prisma: PrismaClient, opts: { bcryptRounds?: number } = {}) {
  const rounds = opts.bcryptRounds ?? 12;
  const hash = (p: string) => bcrypt.hash(p, rounds);
  const officerPass = process.env.SEED_OFFICER_PASSWORD ?? 'officer123';
  const studentPass = process.env.SEED_STUDENT_PASSWORD ?? 'student123';
  const mentorPass = process.env.SEED_MENTOR_PASSWORD ?? 'mentor123';

  const officer = await prisma.user.upsert({
    where: { email: 'officer@edualert.app' },
    update: {},
    create: { email: 'officer@edualert.app', passwordHash: await hash(officerPass), role: 'TPC_OFFICER', firstName: 'Priya', lastName: 'Nair' },
  });

  const mentorUser = await prisma.user.upsert({
    where: { email: 'mentor@edualert.app' },
    update: {},
    create: {
      email: 'mentor@edualert.app', passwordHash: await hash(mentorPass), role: 'MENTOR', firstName: 'Rohan', lastName: 'Mehta',
      mentor: { create: { specialty: 'Data Structures & Algorithms', bio: 'Ex-SDE, 8 years of interview experience.', experienceYears: 8, rating: 4.8 } },
    },
    include: { mentor: true },
  });
  const mentor = mentorUser.mentor ?? (await prisma.mentor.findUniqueOrThrow({ where: { userId: mentorUser.id } }));

  const students = [
    { email: 'student1@edualert.app', first: 'Aarav', last: 'Sharma', roll: 'CSE2023001', branch: 'CSE', year: 3, cgpa: 7.8, backlogs: 0, skills: { dsaPct: 62, aptitudePct: 71, communicationPct: 58, domainPct: 65, mockInterviewPct: 40 } },
    { email: 'student2@edualert.app', first: 'Diya', last: 'Patel', roll: 'ECE2023002', branch: 'ECE', year: 3, cgpa: 5.6, backlogs: 2, skills: { dsaPct: 20, aptitudePct: 35, communicationPct: 30, domainPct: 25, mockInterviewPct: 10 } },
  ];
  for (const s of students) {
    const user = await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: { email: s.email, passwordHash: await hash(studentPass), role: 'STUDENT', firstName: s.first, lastName: s.last },
    });
    const student = await prisma.student.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, rollNumber: s.roll, branch: s.branch, year: s.year, cgpa: s.cgpa, backlogs: s.backlogs, skills: { create: s.skills } },
    });
    if ((await prisma.studentScore.count({ where: { studentId: student.id } })) === 0) await recordScore(prisma, student.id);
  }

  const drives = [
    { name: 'Microsoft', sector: 'Software', ctcMin: 1800000, ctcMax: 4200000, minCgpa: 7.0, maxBacklogs: 0, eligibleBranches: ['CSE', 'IT', 'ECE'], status: 'UPCOMING' as const },
    { name: 'TCS', sector: 'IT Services', ctcMin: 350000, ctcMax: 700000, minCgpa: 6.0, maxBacklogs: 1, eligibleBranches: ['CSE', 'IT', 'ECE', 'MECH', 'CIVIL'], status: 'OPEN' as const },
  ];
  for (const d of drives) {
    if (!(await prisma.company.findFirst({ where: { name: d.name } }))) await prisma.company.create({ data: d });
  }

  const courseTitle = 'DSA Foundations: Arrays & Strings';
  let course = await prisma.course.findFirst({ where: { title: courseTitle } });
  if (!course) {
    course = await prisma.course.create({
      data: {
        title: courseTitle,
        category: 'DSA',
        instructorId: mentorUser.id,
        description: 'Core patterns for array/string problems asked in interviews.',
        totalLessons: 2,
        durationMinutes: 55,
        lessons: {
          create: [
            { title: 'Two Pointers Technique', orderIndex: 1, videoUrl: 'https://cdn.example.com/videos/two-pointers.mp4', durationSeconds: 1800, hasQuiz: true },
            { title: 'Sliding Window Patterns', orderIndex: 2, videoUrl: 'https://cdn.example.com/videos/sliding-window.mp4', durationSeconds: 1500, hasQuiz: false },
          ],
        },
      },
    });
    const first = await prisma.lesson.findFirstOrThrow({ where: { courseId: course.id, orderIndex: 1 } });
    await prisma.quiz.create({
      data: {
        lessonId: first.id,
        title: 'Two Pointers — quick check',
        questions: {
          create: [
            { text: 'Two pointers is most useful on which kind of input?', options: ['Sorted arrays', 'Hash maps', 'Binary trees', 'Graphs'], correctOption: 0 },
            { text: 'Time complexity of a single two-pointer pass over n items?', options: ['O(n^2)', 'O(n)', 'O(log n)', 'O(1)'], correctOption: 1 },
          ],
        },
      },
    });
  }

  if ((await prisma.mentorSlot.count({ where: { mentorId: mentor.id } })) === 0) {
    const day = 24 * 3600_000;
    const at = (d: number, h: number) => { const t = new Date(Date.now() + d * day); t.setUTCHours(h, 0, 0, 0); return t; };
    await prisma.mentorSlot.createMany({
      data: [1, 2, 3].map((d) => ({ mentorId: mentor.id, startTime: at(d, 10), endTime: at(d, 11) })),
    });
  }

  if (!(await prisma.announcement.findFirst({ where: { title: 'Welcome to EduAlert' } }))) {
    await prisma.announcement.create({
      data: { title: 'Welcome to EduAlert', body: 'Complete your profile, check eligible drives and book a mentor session.', pinned: true, postedById: officer.id },
    });
  }

  // Career content (idempotent: looked up by title).
  const roadmapTitle = 'Software Engineer — 8-week plan';
  if (!(await prisma.roadmap.findFirst({ where: { title: roadmapTitle } }))) {
    await prisma.roadmap.create({
      data: {
        title: roadmapTitle,
        targetRole: 'Software Engineer',
        description: 'A starter plan covering the areas placement drives test most.',
        steps: {
          create: [
            { title: 'Arrays, strings and hashing', category: 'DSA', orderIndex: 0, durationDays: 14 },
            { title: 'Quantitative and logical aptitude drills', category: 'APTITUDE', orderIndex: 1, durationDays: 14 },
            { title: 'Communication and group discussion practice', category: 'COMMUNICATION', orderIndex: 2, durationDays: 7 },
            { title: 'Mock interviews', category: 'HR', orderIndex: 3, durationDays: 14 },
          ],
        },
      },
    });
  }
  if (!(await prisma.prepGuide.findFirst({ where: { title: 'How to prepare for the aptitude round' } }))) {
    await prisma.prepGuide.create({
      data: {
        title: 'How to prepare for the aptitude round',
        category: 'APTITUDE',
        summary: 'A short checklist for the first screening round.',
        body: 'Practise timed sets daily.\nReview every wrong answer and note the topic.\nRevise percentages, ratios and number series first.',
      },
    });
  }
  if (!(await prisma.tip.findFirst({ where: { title: 'Build a daily DSA habit' } }))) {
    await prisma.tip.create({
      data: {
        category: 'DSA', title: 'Build a daily DSA habit', belowPct: 60,
        body: 'Solve one problem a day and write down the pattern you used.',
        actionText: 'Open the DSA lectures',
      },
    });
  }

  return { officer: officer.email, mentor: mentorUser.email, students: students.map((s) => s.email), course: course.title };
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
    throw new Error('Refusing to seed demo accounts with NODE_ENV=production (set SEED_ALLOW_PRODUCTION=true to override).');
  }
  const prisma = new PrismaClient();
  try {
    console.log('Seed complete:', await runSeed(prisma));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
