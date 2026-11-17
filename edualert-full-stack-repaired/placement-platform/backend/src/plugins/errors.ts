import { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

const isPrismaKnown = (e: any): boolean =>
  e && typeof e === 'object' && e.name === 'PrismaClientKnownRequestError' && typeof e.code === 'string';
const isPrismaInit = (e: any) => e && typeof e === 'object' && e.name === 'PrismaClientInitializationError';

/**
 * One consistent error contract for the whole API:  { "error": "<message>", "details"?: ... }
 * Internal errors (SQL, stack traces, driver messages) are logged server-side and never sent to the client.
 * Must be registered BEFORE route plugins: Fastify child contexts copy the handler at creation time.
 */
export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, req, reply) => {
    const err = error as any; // errors may come from Zod, Prisma, Fastify or our own code
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    }
    if (isPrismaKnown(err)) {
      switch (err.code) {
        case 'P2002': {
          const t = err.meta?.target;
          const fields = Array.isArray(t) ? t.join(', ') : typeof t === 'string' ? t : undefined;
          return reply.code(409).send({ error: fields ? `A record with this ${fields} already exists` : 'Record already exists' });
        }
        case 'P2025':
          return reply.code(404).send({ error: 'Record not found' });
        case 'P2003':
          return reply.code(409).send({ error: 'Operation conflicts with related records' });
        case 'P1001':
        case 'P1002':
        case 'P1008':
        case 'P1017':
          req.log.error(err);
          return reply.code(503).send({ error: 'Database unavailable, please retry shortly' });
        default:
          req.log.error(err);
          return reply.code(500).send({ error: 'Internal server error' });
      }
    }
    if (isPrismaInit(err)) {
      req.log.error(err);
      return reply.code(503).send({ error: 'Database unavailable, please retry shortly' });
    }

    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error(err);
      return reply.code(status).send({ error: 'Internal server error' });
    }
    // 4xx raised by our own code (parseOrThrow, httpErrors) or by Fastify (rate limit, body too large, bad JSON…)
    return reply.code(status).send({ error: err.message });
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: `Route ${req.method} ${req.url.split('?')[0]} not found` }));
}
