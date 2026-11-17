import { FastifyInstance } from 'fastify';
import { requireRole } from '../middlewares/rbac.js';

export default async function analyticsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const officerOnly = { preHandler: [fastify.authenticate, requireRole('TPC_OFFICER', 'ADMIN')] };

  // Headline numbers for the officer dashboard (everything computed by SQL, nothing static).
  fastify.get('/summary', officerOnly, async (_req, reply) => {
    const [students, openAlerts, drives, byStatus, risk] = await Promise.all([
      prisma.student.count(),
      prisma.alert.count({ where: { resolvedAt: null } }),
      prisma.company.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.application.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.$queryRaw<{ riskLevel: string; count: number }[]>`
        SELECT t."riskLevel"::text AS "riskLevel", COUNT(*)::int AS count FROM (
          SELECT DISTINCT ON ("studentId") "studentId", "riskLevel" FROM "StudentScore" ORDER BY "studentId", "recordedAt" DESC
        ) t GROUP BY t."riskLevel"`,
    ]);
    reply.send({
      students,
      openAlerts,
      riskDistribution: { HIGH: 0, MEDIUM: 0, LOW: 0, ...Object.fromEntries(risk.map((r) => [r.riskLevel, r.count])) },
      drives: Object.fromEntries(drives.map((d) => [d.status, d._count._all])),
      applications: Object.fromEntries(byStatus.map((d) => [d.status, d._count._all])),
    });
  });

  // Daily average placement score + risk distribution for the last 30 days
  fastify.get('/risk-trends', officerOnly, async (_req, reply) => {
    reply.send(
      await prisma.$queryRaw`
        SELECT DATE("recordedAt")::text AS day,
               ROUND(AVG("placementScore")::numeric, 1)::float AS "avgScore",
               COUNT(*) FILTER (WHERE "riskLevel" = 'HIGH')::int   AS high,
               COUNT(*) FILTER (WHERE "riskLevel" = 'MEDIUM')::int AS medium,
               COUNT(*) FILTER (WHERE "riskLevel" = 'LOW')::int    AS low
        FROM "StudentScore"
        WHERE "recordedAt" > NOW() - INTERVAL '30 days'
        GROUP BY DATE("recordedAt") ORDER BY day`
    );
  });

  fastify.get('/branch-breakdown', officerOnly, async (_req, reply) => {
    reply.send(
      await prisma.$queryRaw`
        SELECT s."branch", COUNT(*)::int AS "studentCount", ROUND(AVG(s."cgpa")::numeric, 2)::float AS "avgCgpa"
        FROM "Student" s GROUP BY s."branch" ORDER BY s."branch"`
    );
  });

  fastify.get('/engagement', officerOnly, async (_req, reply) => {
    reply.send(
      await prisma.$queryRaw`
        SELECT DATE("occurredAt")::text AS day, COUNT(*)::int AS events
        FROM "ActivityLog" WHERE "occurredAt" > NOW() - INTERVAL '30 days'
        GROUP BY DATE("occurredAt") ORDER BY day`
    );
  });

  // Leaderboard. Officers see full detail; students get a privacy-preserving ranking
  // (first name + last initial, no risk level, no ids) — peers' risk status is not theirs to see.
  fastify.get('/leaderboard', { preHandler: fastify.authenticate }, async (req, reply) => {
    const rows = await prisma.$queryRaw<
      { studentId: string; userId: string; placementScore: number; riskLevel: string; firstName: string; lastName: string; branch: string }[]
    >`
      SELECT ss."studentId", s."userId", ss."placementScore", ss."riskLevel"::text AS "riskLevel", u."firstName", u."lastName", s."branch"
      FROM (SELECT DISTINCT ON ("studentId") * FROM "StudentScore" ORDER BY "studentId", "recordedAt" DESC) ss
      JOIN "Student" s ON s.id = ss."studentId"
      JOIN "User" u ON u.id = s."userId"
      ORDER BY ss."placementScore" DESC LIMIT 10`;
    const user = req.currentUser!;
    if (user.role === 'TPC_OFFICER' || user.role === 'ADMIN') {
      return reply.send(rows.map(({ userId: _u, ...r }, i) => ({ rank: i + 1, ...r })));
    }
    reply.send(
      rows.map((r, i) => ({
        rank: i + 1,
        displayName: `${r.firstName} ${r.lastName.charAt(0)}.`,
        branch: r.branch,
        placementScore: r.placementScore,
        isYou: r.userId === user.id,
      }))
    );
  });
}
