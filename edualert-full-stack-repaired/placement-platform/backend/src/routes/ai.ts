import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { chatMessageSchema, parseOrThrow } from '../utils/validator.js';

/** Streams an assistant reply, calling onText for each delta. Injectable so tests never hit the network. */
export type ChatStreamer = (args: {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  onText: (delta: string) => void;
  signal: AbortSignal;
}) => Promise<void>;

export const anthropicStreamer: ChatStreamer = async ({ system, messages, onText, signal }) => {
  // The key lives ONLY here, server-side, from the environment. It is never sent to or read by the browser.
  const client = new Anthropic({ apiKey: env.CLAUDE_API_KEY });
  const stream = client.messages.stream({ model: env.CLAUDE_MODEL, max_tokens: 1024, system, messages });
  signal.addEventListener('abort', () => stream.abort());
  stream.on('text', onText);
  await stream.finalMessage();
};

const sessionParam = z.object({ sessionId: z.string().uuid() });
const HISTORY_LIMIT = 20;

export default async function aiRoutes(fastify: FastifyInstance, opts: { chat?: ChatStreamer }) {
  const { prisma } = fastify;
  const chat = opts.chat ?? anthropicStreamer;

  async function buildSystemPrompt(userId: string, role: string): Promise<string> {
    if (role !== 'STUDENT') {
      return 'You are EduAlert, an assistant for a college Training & Placement Cell. Give general placement-preparation and placement-cell guidance. You do not have access to any individual student records in this conversation.';
    }
    const student = await prisma.student.findUnique({
      where: { userId },
      include: { skills: true, scores: { orderBy: { recordedAt: 'desc' }, take: 1 } },
    });
    if (!student) return 'You are EduAlert, a placement-readiness assistant.';
    const latest = student.scores[0];
    return [
      'You are EduAlert, a placement-readiness assistant for a single student.',
      "Only discuss this student's own data — never compare them by name to other named students.",
      `Student profile: branch=${student.branch}, year=${student.year}, CGPA=${student.cgpa}, backlogs=${student.backlogs}.`,
      student.skills
        ? `Skill levels: DSA=${student.skills.dsaPct}%, Aptitude=${student.skills.aptitudePct}%, Communication=${student.skills.communicationPct}%, Domain=${student.skills.domainPct}%, Mock interviews=${student.skills.mockInterviewPct}%.`
        : '',
      latest ? `Latest placement-readiness score: ${latest.placementScore.toFixed(1)}% (${latest.riskLevel} risk).` : '',
    ].filter(Boolean).join('\n');
  }

  /** Session must exist AND belong to the caller. Otherwise 404 (never reveal other users' session ids). */
  async function ownedSession(sessionId: string, userId: string) {
    const s = await prisma.chatSession.findUnique({ where: { id: sessionId } });
    return s && s.userId === userId ? s : null;
  }

  fastify.get('/session', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.currentUser!.id;
    const session =
      (await prisma.chatSession.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } })) ??
      (await prisma.chatSession.create({ data: { userId } }));
    reply.send({ sessionId: session.id });
  });

  fastify.get('/session/:sessionId/messages', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { sessionId } = parseOrThrow(sessionParam, req.params);
    if (!(await ownedSession(sessionId, req.currentUser!.id))) return reply.code(404).send({ error: 'Chat session not found' });
    reply.send(await prisma.chatMessage.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' }, take: 200 }));
  });

  // Streaming chat (Server-Sent Events over a normal authenticated POST — the JWT travels in the
  // Authorization header, never in a URL where it would end up in logs / history / proxies).
  fastify.post('/chat/:sessionId', { preHandler: fastify.authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { sessionId } = parseOrThrow(sessionParam, req.params);
    const { message } = parseOrThrow(chatMessageSchema, req.body);
    const user = req.currentUser!;

    if (!(await ownedSession(sessionId, user.id))) return reply.code(404).send({ error: 'Chat session not found' });
    if (!env.CLAUDE_API_KEY && chat === anthropicStreamer) {
      return reply.code(503).send({ error: 'The AI assistant is not configured on this server' });
    }

    const recent = await prisma.chatMessage.count({
      where: { session: { userId: user.id }, role: 'USER', createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
    });
    if (recent >= 20) return reply.code(429).send({ error: 'Rate limit exceeded — please wait a few minutes.' });

    // Prior turns give the model conversational context (previously only the latest message was sent).
    const prior = await prisma.chatMessage.findMany({ where: { sessionId }, orderBy: { createdAt: 'desc' }, take: HISTORY_LIMIT });
    const turns: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const m of [...prior.reverse().map((p) => ({ role: p.role === 'USER' ? ('user' as const) : ('assistant' as const), content: p.content })), { role: 'user' as const, content: message }]) {
      const last = turns[turns.length - 1];
      if (last && last.role === m.role) last.content += `\n\n${m.content}`; // the API requires alternating roles
      else if (turns.length > 0 || m.role === 'user') turns.push({ ...m });
    }

    const userMsg = await prisma.chatMessage.create({ data: { sessionId, role: 'USER', content: message } });
    const system = await buildSystemPrompt(user.id, user.role);

    // reply.raw bypasses Fastify's header pipeline, so carry over CORS/security headers explicitly.
    reply.hijack();
    reply.raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const ac = new AbortController();
    reply.raw.on('close', () => ac.abort());
    let fullText = '';
    let failed = false;
    try {
      await chat({
        system,
        messages: turns,
        signal: ac.signal,
        onText: (delta) => {
          fullText += delta;
          reply.raw.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
        },
      });
    } catch (err) {
      if (!ac.signal.aborted) {
        failed = true;
        req.log.error(err);
        // Generic message only — never forward provider/internal error text.
        reply.raw.write(`data: ${JSON.stringify({ error: 'The assistant could not complete that reply. Please try again.' })}\n\n`);
      }
    }

    try {
      if (fullText) await prisma.chatMessage.create({ data: { sessionId, role: 'ASSISTANT', content: fullText } });
      else if (failed) await prisma.chatMessage.delete({ where: { id: userMsg.id } }); // don't keep an unanswered orphan turn
    } catch (err) {
      req.log.error(err);
    }
    if (!reply.raw.writableEnded) {
      reply.raw.write('event: done\ndata: {}\n\n');
      reply.raw.end();
    }
  });
}
