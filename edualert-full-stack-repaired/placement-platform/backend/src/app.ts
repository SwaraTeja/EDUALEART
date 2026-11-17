import Fastify, { FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';

import { env } from './config/env.js';
import { registerErrorHandling } from './plugins/errors.js';
import authPlugin from './plugins/auth.js';
import s3Plugin from './services/s3.js';

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import studentRoutes from './routes/students.js';
import companyRoutes from './routes/companies.js';
import mentorRoutes from './routes/mentors.js';
import bookingRoutes from './routes/bookings.js';
import courseRoutes from './routes/courses.js';
import aiRoutes, { ChatStreamer } from './routes/ai.js';
import analyticsRoutes from './routes/analytics.js';
import announcementRoutes from './routes/announcements.js';
import alertRoutes from './routes/alerts.js';
import roadmapRoutes from './routes/roadmaps.js';
import guideRoutes from './routes/guides.js';
import tipRoutes from './routes/tips.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export interface AppOptions {
  prisma: PrismaClient;
  logger?: boolean;
  /** Disable only in tests that aren't exercising rate limiting. */
  rateLimit?: boolean;
  chat?: ChatStreamer;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    trustProxy: env.TRUST_PROXY,
    // Don't let a bad Content-Length / huge body exhaust memory.
    bodyLimit: 1024 * 1024,
  });

  app.decorate('prisma', opts.prisma);

  // Order matters: the error handler must exist before the route plugins are registered.
  registerErrorHandling(app);

  await app.register(sensible);
  await app.register(helmet, { crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], // the plugin default omits PUT/PATCH/DELETE
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Total-Count'],
    credentials: false, // bearer tokens, not cookies
    maxAge: 600,
  });
  if (opts.rateLimit !== false) await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(s3Plugin);
  await app.register(authPlugin);

  // Liveness + DB readiness. 503 when the database can't be reached, so orchestrators / the UI can tell.
  const health = async (_req: unknown, reply: any) => {
    try {
      await opts.prisma.$queryRaw`SELECT 1`;
      return { ok: true, db: 'up', uptime: Math.round(process.uptime()) };
    } catch {
      return reply.code(503).send({ ok: false, db: 'down' });
    }
  };
  app.get('/health', health);
  app.get('/api/health', health);

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(studentRoutes, { prefix: '/api/students' });
  await app.register(companyRoutes, { prefix: '/api/companies' });
  await app.register(mentorRoutes, { prefix: '/api/mentors' });
  await app.register(bookingRoutes, { prefix: '/api/bookings' });
  await app.register(courseRoutes, { prefix: '/api/courses' });
  await app.register(aiRoutes, { prefix: '/api/ai', chat: opts.chat });
  await app.register(analyticsRoutes, { prefix: '/api/analytics' });
  await app.register(announcementRoutes, { prefix: '/api/announcements' });
  await app.register(alertRoutes, { prefix: '/api/alerts' });
  await app.register(roadmapRoutes, { prefix: '/api/roadmaps' });
  await app.register(guideRoutes, { prefix: '/api/guides' });
  await app.register(tipRoutes, { prefix: '/api/tips' });

  return app;
}
