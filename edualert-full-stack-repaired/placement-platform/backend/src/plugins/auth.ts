import fp from 'fastify-plugin';
import { FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from '../lib/tokens.js';
import { authUserSelect } from '../lib/serializers.js';
import type { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  firstName: string;
  lastName: string;
  isActive: boolean;
  tokenVersion: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    /** Populated by `authenticate`. Role is read from the DB on every request, never trusted from the token. */
    currentUser?: AuthUser;
  }
}

export default fp(async (fastify) => {
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return reply.code(401).send({ error: 'Authentication required', code: 'NO_TOKEN' });

    let payload;
    try {
      payload = verifyToken('access', token);
    } catch (err: any) {
      const expired = err?.name === 'TokenExpiredError';
      return reply.code(401).send({
        error: expired ? 'Session expired' : 'Invalid token',
        code: expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      });
    }

    const user = await fastify.prisma.user.findUnique({ where: { id: payload.id }, select: authUserSelect });
    if (!user || !user.isActive || user.tokenVersion !== payload.tv) {
      return reply.code(401).send({ error: 'Session is no longer valid', code: 'INVALID_TOKEN' });
    }
    request.currentUser = user;
  });
});
