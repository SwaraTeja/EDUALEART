import { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@prisma/client';

/**
 * Usage: { preHandler: [fastify.authenticate, requireRole('ADMIN')] }
 * Must run AFTER fastify.authenticate so request.currentUser is populated.
 */
export function requireRole(...allowed: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.currentUser;
    if (!user || !allowed.includes(user.role)) {
      return reply.code(403).send({ error: 'Insufficient privileges' });
    }
  };
}
