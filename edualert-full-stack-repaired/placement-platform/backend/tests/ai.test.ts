import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setup, truncateAll, Ctx, makeStudent, login, bearer } from './helpers/app.js';
import type { ChatStreamer } from '../src/routes/ai.js';

const calls: Parameters<ChatStreamer>[0][] = [];
let mode: 'ok' | 'fail' = 'ok';
const fake: ChatStreamer = async (args) => {
  calls.push({ ...args, messages: args.messages.map((m) => ({ ...m })) });
  if (mode === 'fail') throw new Error('anthropic 401 invalid x-api-key sk-ant-SECRET');
  args.onText('Hello '); args.onText('there');
};

let ctx: Ctx;
beforeAll(async () => { ctx = await setup({ chat: fake }); });
afterAll(async () => { await ctx.close(); });
beforeEach(async () => { await truncateAll(ctx.prisma); calls.length = 0; mode = 'ok'; });

const who = async () => { const s = await makeStudent(ctx.prisma); const h = bearer((await login(ctx.app, s.user.email)).token); const { sessionId } = (await ctx.app.inject({ url: '/api/ai/session', headers: h })).json(); return { ...s, h, sessionId }; };
const chat = (sessionId: string, h: any, message: unknown) => ctx.app.inject({ method: 'POST', url: `/api/ai/chat/${sessionId}`, headers: { ...h, origin: 'http://localhost:3000' }, payload: { message } as any });

describe('AI assistant', () => {
  it('streams SSE with CORS headers, persists both turns, and survives a refresh', async () => {
    const u = await who();
    const r = await chat(u.sessionId, u.h, 'How am I doing?');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/event-stream/);
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(r.body).toContain('data: {"text":"Hello "}');
    expect(r.body).toContain('event: done');
    const hist = (await ctx.app.inject({ url: `/api/ai/session/${u.sessionId}/messages`, headers: u.h })).json();
    expect(hist.map((m: any) => [m.role, m.content])).toEqual([['USER', 'How am I doing?'], ['ASSISTANT', 'Hello there']]);
    // same session is reused after "reload"
    expect((await ctx.app.inject({ url: '/api/ai/session', headers: u.h })).json().sessionId).toBe(u.sessionId);
  });

  it('sends prior turns as context and builds the system prompt from the caller\'s own data only', async () => {
    const u = await who(); const other = await who();
    await chat(u.sessionId, u.h, 'first'); await chat(u.sessionId, u.h, 'second');
    expect(calls[1].messages.map((m) => `${m.role}:${m.content}`)).toEqual(['user:first', 'assistant:Hello there', 'user:second']);
    expect(calls[0].system).toContain(`branch=${u.student.branch}`);
    expect(calls[0].system).not.toContain(other.user.firstName);
  });

  it('requires auth and ownership (another user\'s session is a 404 for both chat and history)', async () => {
    const a = await who(); const b = await who();
    expect((await ctx.app.inject({ method: 'POST', url: `/api/ai/chat/${a.sessionId}`, payload: { message: 'x' } })).statusCode).toBe(401);
    expect((await chat(a.sessionId, b.h, 'x')).statusCode).toBe(404);
    expect((await ctx.app.inject({ url: `/api/ai/session/${a.sessionId}/messages`, headers: b.h })).statusCode).toBe(404);
    expect((await ctx.app.inject({ url: `/api/ai/session/${a.sessionId}/messages` })).statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('validates the message (empty / too long / wrong type) and rate-limits per user', async () => {
    const u = await who();
    for (const bad of ['', '   ', 'x'.repeat(2001), 123, null]) expect((await chat(u.sessionId, u.h, bad)).statusCode).toBe(400);
    for (let i = 0; i < 20; i++) expect((await chat(u.sessionId, u.h, `m${i}`)).statusCode).toBe(200);
    expect((await chat(u.sessionId, u.h, 'one too many')).statusCode).toBe(429);
  });

  it('provider failure: client gets a generic error event (no key/provider text) and no orphan message is kept', async () => {
    const u = await who(); mode = 'fail';
    const r = await chat(u.sessionId, u.h, 'hi');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('"error"');
    expect(r.body).not.toMatch(/sk-ant|anthropic|x-api-key/);
    expect(r.body).toContain('event: done');
    expect(await ctx.prisma.chatMessage.count()).toBe(0);
  });

  it('returns 503 (before storing anything) when no API key is configured and no streamer is injected', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ prisma: ctx.prisma, logger: false, rateLimit: false });
    const u = await who();
    const r = await app.inject({ method: 'POST', url: `/api/ai/chat/${u.sessionId}`, headers: u.h, payload: { message: 'hi' } });
    expect(r.statusCode).toBe(503);
    expect(await ctx.prisma.chatMessage.count()).toBe(0);
    await app.close();
  });
});
