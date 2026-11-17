import { z } from 'zod';

/* ------------------------------ primitives ------------------------------ */

export const email = z.string().trim().toLowerCase().email().max(254);
export const password = z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password must be at most 72 characters');
const name = z.string().trim().min(1).max(60);
const branch = z.string().trim().min(1).max(40).transform((v) => v.toUpperCase());
const rollNumber = z.string().trim().min(1).max(32);
const phone = z.string().trim().regex(/^\+?[0-9 ()-]{7,15}$/, 'Invalid phone number');
const httpUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'URL must start with http:// or https://');
const uuid = z.string().uuid();

export const idParam = z.object({ id: uuid });

/* --------------------------------- auth --------------------------------- */

// `.strict()` — a signup body containing e.g. `role` is rejected outright instead of silently ignored.
export const signupSchema = z
  .object({
    email,
    password,
    firstName: name,
    lastName: name,
    rollNumber,
    branch,
    year: z.number().int().min(1).max(6),
  })
  .strict();

export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
export const refreshSchema = z.object({ refreshToken: z.string().min(10).max(2000) });
export const requestResetSchema = z.object({ email });
export const resetSchema = z.object({ token: z.string().min(10).max(2000), newPassword: password });

export const adminCreateUserSchema = z
  .object({
    email,
    firstName: name,
    lastName: name,
    role: z.enum(['TPC_OFFICER', 'MENTOR', 'ADMIN']),
    // mentor-only profile fields
    specialty: z.string().trim().max(100).optional(),
    bio: z.string().trim().max(1000).optional(),
    experienceYears: z.number().int().min(0).max(60).optional(),
  })
  .strict();

export const adminUpdateUserSchema = z.object({ isActive: z.boolean() }).strict();

/* -------------------------------- students ------------------------------- */

export const studentCreateSchema = z
  .object({
    email,
    firstName: name,
    lastName: name,
    rollNumber,
    branch,
    year: z.number().int().min(1).max(6),
    cgpa: z.number().min(0).max(10),
    backlogs: z.number().int().min(0).max(50).default(0),
    tenthPct: z.number().min(0).max(100).optional(),
    twelfthPct: z.number().min(0).max(100).optional(),
    phone: phone.optional(),
    linkedinUrl: httpUrl.optional(),
  })
  .strict();

export const studentBulkSchema = z.array(studentCreateSchema).min(1).max(500);

// Officer/admin may edit every academic + profile field.
export const studentOfficerUpdateSchema = z
  .object({
    firstName: name,
    lastName: name,
    rollNumber,
    branch,
    year: z.number().int().min(1).max(6),
    cgpa: z.number().min(0).max(10),
    backlogs: z.number().int().min(0).max(50),
    tenthPct: z.number().min(0).max(100).nullable(),
    twelfthPct: z.number().min(0).max(100).nullable(),
    phone: phone.nullable(),
    linkedinUrl: httpUrl.nullable(),
    status: z.string().trim().max(40).nullable(),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update');

// A student may only edit contact details. Academic data (CGPA, backlogs, branch, year) drives
// drive-eligibility and risk scoring, so it is officer-managed.
export const studentSelfUpdateSchema = z
  .object({ phone: phone.nullable(), linkedinUrl: httpUrl.nullable() })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update');

export const studentSkillsSchema = z
  .object({
    dsaPct: z.number().min(0).max(100),
    aptitudePct: z.number().min(0).max(100),
    communicationPct: z.number().min(0).max(100),
    domainPct: z.number().min(0).max(100),
    mockInterviewPct: z.number().min(0).max(100),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update');

export const studentListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  branch: z.string().trim().min(1).max(40).transform((v) => v.toUpperCase()).optional(),
  riskLevel: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  search: z.string().trim().min(1).max(80).optional(),
});

/* ------------------------------- companies ------------------------------- */

const companyBase = z.object({
  name: z.string().trim().min(1).max(120),
  sector: z.string().trim().max(80).nullable().optional(),
  logoUrl: httpUrl.nullable().optional(),
  ctcMin: z.number().min(0).nullable().optional(),
  ctcMax: z.number().min(0).nullable().optional(),
  minCgpa: z.number().min(0).max(10).nullable().optional(),
  maxBacklogs: z.number().int().min(0).nullable().optional(),
  eligibleBranches: z.array(branch).max(30).optional(),
  status: z.enum(['OPEN', 'UPCOMING', 'CLOSED']).optional(),
  driveDate: z.coerce.date().nullable().optional(),
});
const ctcOrder = (c: { ctcMin?: number | null; ctcMax?: number | null }) =>
  c.ctcMin == null || c.ctcMax == null || c.ctcMin <= c.ctcMax;

export const companyCreateSchema = companyBase.strict().refine(ctcOrder, { message: 'ctcMin must be <= ctcMax', path: ['ctcMin'] });
export const companyUpdateSchema = companyBase
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update')
  .refine(ctcOrder, { message: 'ctcMin must be <= ctcMax', path: ['ctcMin'] });
export const applicationStatusSchema = z.object({ status: z.enum(['APPLIED', 'SHORTLISTED', 'SELECTED', 'REJECTED']) }).strict();

/* -------------------------------- mentors -------------------------------- */

export const mentorUpdateSchema = z
  .object({
    specialty: z.string().trim().max(100).nullable(),
    bio: z.string().trim().max(1000).nullable(),
    experienceYears: z.number().int().min(0).max(60).nullable(),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update');

export const slotCreateSchema = z
  .object({ startTime: z.coerce.date(), endTime: z.coerce.date() })
  .strict()
  .refine((s) => s.endTime > s.startTime, { message: 'endTime must be after startTime', path: ['endTime'] })
  .refine((s) => s.endTime.getTime() - s.startTime.getTime() <= 4 * 3600_000, {
    message: 'A slot may not be longer than 4 hours',
    path: ['endTime'],
  });
export const slotListQuery = z.object({ mentorId: uuid.optional() });
export const bookingSchema = z.object({ slotId: uuid, notes: z.string().trim().max(500).optional() }).strict();

/* -------------------------------- courses -------------------------------- */

const category = z.enum(['DSA', 'APTITUDE', 'COMMUNICATION', 'DOMAIN', 'HR']);
export const courseListQuery = z.object({ category: category.optional(), search: z.string().trim().max(80).optional() });
export const courseCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    category,
    description: z.string().trim().max(2000).optional(),
    durationMinutes: z.number().int().min(1).max(100000).optional(),
    thumbnailUrl: httpUrl.optional(),
  })
  .strict();
export const courseUpdateSchema = courseCreateSchema
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update');
export const lessonCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    orderIndex: z.number().int().min(0).max(10000).optional(),
    videoUrl: httpUrl,
    durationSeconds: z.number().int().min(1).max(86400),
    resources: z.array(httpUrl).max(20).default([]),
    hasQuiz: z.boolean().default(false),
  })
  .strict();
export const lessonUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    orderIndex: z.number().int().min(0).max(10000),
    videoUrl: httpUrl,
    durationSeconds: z.number().int().min(1).max(86400),
    resources: z.array(httpUrl).max(20),
    hasQuiz: z.boolean(),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update');
export const quizCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    questions: z
      .array(
        z.object({
          text: z.string().trim().min(1).max(500),
          options: z.array(z.string().trim().min(1).max(300)).min(2).max(8),
          correctOption: z.number().int().min(0),
        })
      )
      .min(1)
      .max(50),
  })
  .strict()
  .refine((q) => q.questions.every((x) => x.correctOption < x.options.length), 'correctOption must index into options');
export const lessonProgressSchema = z.object({ lessonId: uuid, watchedSeconds: z.number().int().min(0).max(86400) }).strict();
export const quizAttemptSchema = z
  .object({
    quizId: uuid,
    answers: z.array(z.object({ questionId: uuid, chosenIndex: z.number().int().min(0).max(20) })).max(100),
  })
  .strict();

/* ------------------------ announcements, alerts, ai ----------------------- */

export const announcementCreateSchema = z
  .object({ title: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(5000), pinned: z.boolean().default(false) })
  .strict();
export const announcementUpdateSchema = z
  .object({ title: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(5000), pinned: z.boolean() })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update');
export const alertCreateSchema = z
  .object({ studentId: uuid, level: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'), message: z.string().trim().min(1).max(500) })
  .strict();
export const alertListQuery = z.object({
  resolved: z.enum(['true', 'false']).optional(),
  level: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const chatMessageSchema = z.object({ message: z.string().trim().min(1).max(2000) }).strict();

/* ------------------- roadmaps, preparation guides, tips ------------------- */

const roadmapBase = z.object({
  title: z.string().trim().min(1).max(160),
  targetRole: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  published: z.boolean().optional(),
});
export const roadmapCreateSchema = roadmapBase.strict();
export const roadmapUpdateSchema = roadmapBase
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update');

const stepBase = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  category: category.nullable().optional(),
  orderIndex: z.number().int().min(0).max(10000).optional(),
  durationDays: z.number().int().min(1).max(365).nullable().optional(),
  resourceUrl: httpUrl.nullable().optional(),
});
export const roadmapStepCreateSchema = stepBase.strict();
export const roadmapStepUpdateSchema = stepBase
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update');
export const stepIdParam = z.object({ stepId: uuid });

const guideBase = z.object({
  title: z.string().trim().min(1).max(160),
  category,
  summary: z.string().trim().max(500).nullable().optional(),
  body: z.string().trim().min(1).max(20000),
  companyId: uuid.nullable().optional(),
  published: z.boolean().optional(),
});
export const guideCreateSchema = guideBase.strict();
export const guideUpdateSchema = guideBase
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update');
export const guideListQuery = z.object({ category: category.optional(), search: z.string().trim().min(1).max(80).optional() });

const tipBase = z.object({
  category,
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(2000),
  actionText: z.string().trim().max(80).nullable().optional(),
  actionUrl: httpUrl.nullable().optional(),
  belowPct: z.number().gt(0).max(100).optional(),
  isActive: z.boolean().optional(),
});
export const tipCreateSchema = tipBase.strict();
export const tipUpdateSchema = tipBase
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update');

/* --------------------------------- helper -------------------------------- */

export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');
    throw Object.assign(new Error(message), { statusCode: 400 });
  }
  return result.data;
}
