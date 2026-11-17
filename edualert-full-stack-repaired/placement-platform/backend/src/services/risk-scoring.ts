import cron from 'node-cron';
import type { Prisma, PrismaClient, RiskLevel } from '@prisma/client';
import { sendHighRiskAlert } from './email.js';

export interface RiskScoringConfig {
  dsaWeight: number;
  aptitudeWeight: number;
  communicationWeight: number;
  domainWeight: number;
  mockWeight: number;
  cgpaWeight: number; // cgpa is on a 0-10 scale, normalized to 0-100 before weighting
  backlogPenalty: number; // points subtracted per backlog
  highRiskThreshold: number; // e.g. 30
  mediumRiskThreshold: number; // e.g. 60
}

export const defaultRiskConfig: RiskScoringConfig = {
  dsaWeight: 0.25,
  aptitudeWeight: 0.15,
  communicationWeight: 0.15,
  domainWeight: 0.15,
  mockWeight: 0.1,
  cgpaWeight: 0.2,
  backlogPenalty: 5,
  highRiskThreshold: 30,
  mediumRiskThreshold: 60,
};

export function computePlacementScore(
  skill: { dsaPct: number; aptitudePct: number; communicationPct: number; domainPct: number; mockInterviewPct: number },
  cgpa: number,
  backlogs: number,
  cfg: RiskScoringConfig = defaultRiskConfig
): number {
  const cgpaPct = (cgpa / 10) * 100;
  const raw =
    skill.dsaPct * cfg.dsaWeight +
    skill.aptitudePct * cfg.aptitudeWeight +
    skill.communicationPct * cfg.communicationWeight +
    skill.domainPct * cfg.domainWeight +
    skill.mockInterviewPct * cfg.mockWeight +
    cgpaPct * cfg.cgpaWeight -
    backlogs * cfg.backlogPenalty;
  return Math.max(0, Math.min(100, raw));
}

export function scoreToRiskLevel(score: number, cfg: RiskScoringConfig = defaultRiskConfig): RiskLevel {
  if (score < cfg.highRiskThreshold) return 'HIGH';
  if (score < cfg.mediumRiskThreshold) return 'MEDIUM';
  return 'LOW';
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Computes and appends ONE StudentScore row for a student (time-series — history is never overwritten).
 * Creates a HIGH alert when the student newly enters HIGH risk. Returns the new score, or null when the
 * student has no skills row yet. Pure DB work, so it can run inside a caller's transaction.
 */
export async function recordScore(db: Db, studentId: string, cfg: RiskScoringConfig = defaultRiskConfig) {
  const student = await db.student.findUnique({
    where: { id: studentId },
    include: {
      skills: true,
      user: { select: { email: true, firstName: true, lastName: true } },
      scores: { orderBy: { recordedAt: 'desc' }, take: 1 },
    },
  });
  if (!student || !student.skills) return null;

  const placementScore = computePlacementScore(student.skills, student.cgpa, student.backlogs, cfg);
  const riskLevel = scoreToRiskLevel(placementScore, cfg);
  const previousLevel = student.scores[0]?.riskLevel;

  await db.studentScore.create({ data: { studentId, placementScore, riskLevel } });

  let newHighRisk = false;
  if (riskLevel === 'HIGH' && previousLevel !== 'HIGH') {
    newHighRisk = true;
    await db.alert.create({
      data: { studentId, level: 'HIGH', message: `Placement readiness dropped to ${placementScore.toFixed(1)}% (high risk).` },
    });
  }
  return { placementScore, riskLevel, newHighRisk, user: student.user };
}

/** Recomputes every student's score. A failure for one student never aborts the rest of the batch. */
export async function runRiskScoringJob(prisma: PrismaClient, cfg: RiskScoringConfig = defaultRiskConfig) {
  const students = await prisma.student.findMany({ select: { id: true } });
  let scored = 0;
  let failed = 0;
  for (const { id } of students) {
    try {
      const result = await recordScore(prisma, id, cfg);
      if (!result) continue;
      scored += 1;
      if (result.newHighRisk) {
        try {
          await sendHighRiskAlert(result.user.email, `${result.user.firstName} ${result.user.lastName}`, result.placementScore);
        } catch (mailErr) {
          console.error(`[risk-scoring] alert e-mail failed for student ${id}:`, (mailErr as Error).message);
        }
      }
    } catch (err) {
      failed += 1;
      console.error(`[risk-scoring] failed for student ${id}:`, (err as Error).message);
    }
  }
  return { studentsScored: scored, failed };
}

/** Registers the nightly cron job. Call once at server startup; returns a stop() handle. */
export function scheduleRiskScoring(prisma: PrismaClient, cfg: RiskScoringConfig = defaultRiskConfig) {
  const task = cron.schedule('0 2 * * *', async () => {
    try {
      console.log('[risk-scoring] running nightly job...');
      const r = await runRiskScoringJob(prisma, cfg);
      console.log(`[risk-scoring] done — scored ${r.studentsScored}, failed ${r.failed}`);
    } catch (err) {
      // Without this, a DB outage at 02:00 would be an unhandled rejection and crash the process.
      console.error('[risk-scoring] nightly job failed:', (err as Error).message);
    }
  });
  return { stop: () => task.stop() };
}
