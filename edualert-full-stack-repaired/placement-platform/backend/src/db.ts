import { PrismaClient } from '@prisma/client';

/** Production Prisma client. Tests build their own client and pass it to buildApp(). */
export const prisma = new PrismaClient();
