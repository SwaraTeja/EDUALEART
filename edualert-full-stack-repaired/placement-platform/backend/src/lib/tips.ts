import type { CourseCategory } from '@prisma/client';

export interface SkillScores {
  dsaPct: number;
  aptitudePct: number;
  communicationPct: number;
  domainPct: number;
  mockInterviewPct: number;
}

/**
 * Which stored skill score a content category is measured against.
 * HR content is measured against the mock-interview score (there is no separate HR score).
 */
export const CATEGORY_SKILL: Record<CourseCategory, keyof SkillScores> = {
  DSA: 'dsaPct',
  APTITUDE: 'aptitudePct',
  COMMUNICATION: 'communicationPct',
  DOMAIN: 'domainPct',
  HR: 'mockInterviewPct',
};

export function scoreForCategory(skills: SkillScores | null | undefined, category: CourseCategory): number {
  // A student with no skill record yet is treated as 0 in every area (so every tip applies).
  return skills ? skills[CATEGORY_SKILL[category]] : 0;
}

/**
 * Rule-based personalisation: a tip applies when the student's score in its category is below the tip's
 * `belowPct`. Weakest areas come first; ties are ordered by title so the output is deterministic.
 */
export function matchTips<T extends { category: CourseCategory; belowPct: number; title: string }>(
  tips: T[],
  skills: SkillScores | null | undefined
): Array<T & { currentPct: number }> {
  return tips
    .map((t) => ({ ...t, currentPct: scoreForCategory(skills, t.category) }))
    .filter((t) => t.currentPct < t.belowPct)
    .sort((a, b) => a.currentPct - b.currentPct || a.title.localeCompare(b.title));
}
