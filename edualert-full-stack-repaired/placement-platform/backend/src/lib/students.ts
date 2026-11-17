import type { Prisma, PrismaClient } from '@prisma/client';
import { publicUserSelect } from './serializers.js';

export const studentInclude = {
  user: { select: publicUserSelect },
  skills: true,
} satisfies Prisma.StudentInclude;

export async function findStudentByUser(prisma: PrismaClient, userId: string) {
  return prisma.student.findUnique({ where: { userId } });
}

/** A mentor may see a student only if that student has booked one of the mentor's slots. */
export async function mentorHasStudent(prisma: PrismaClient, mentorUserId: string, studentId: string) {
  const n = await prisma.booking.count({ where: { studentId, slot: { mentor: { userId: mentorUserId } } } });
  return n > 0;
}
