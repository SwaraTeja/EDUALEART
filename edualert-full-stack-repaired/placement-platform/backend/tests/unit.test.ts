import { describe, expect, it } from 'vitest';
import { computePlacementScore, scoreToRiskLevel } from '../src/services/risk-scoring.js';
import { checkEligibility } from '../src/lib/eligibility.js';
import { signupSchema, studentSelfUpdateSchema, companyCreateSchema } from '../src/utils/validator.js';
import { escapeHtml } from '../src/lib/serializers.js';
import { matchTips, scoreForCategory } from '../src/lib/tips.js';

describe('risk scoring', () => {
  const skill = (n: number) => ({ dsaPct: n, aptitudePct: n, communicationPct: n, domainPct: n, mockInterviewPct: n });
  it('is bounded to 0..100 and penalises backlogs', () => {
    expect(computePlacementScore(skill(100), 10, 0)).toBeCloseTo(100);
    expect(computePlacementScore(skill(0), 0, 9)).toBe(0);
    expect(computePlacementScore(skill(60), 7, 0) - computePlacementScore(skill(60), 7, 2)).toBeCloseTo(10);
  });
  it('maps thresholds to HIGH / MEDIUM / LOW', () => {
    expect([29.9, 30, 59.9, 60].map((s) => scoreToRiskLevel(s))).toEqual(['HIGH', 'MEDIUM', 'MEDIUM', 'LOW']);
  });
});

describe('eligibility', () => {
  const co = { minCgpa: 7, maxBacklogs: 1, eligibleBranches: ['CSE', 'IT'] };
  it('passes / fails with every reason listed, case-insensitive on branch', () => {
    expect(checkEligibility({ cgpa: 7, backlogs: 1, branch: 'cse' }, co).eligible).toBe(true);
    const r = checkEligibility({ cgpa: 6.9, backlogs: 2, branch: 'MECH' }, co);
    expect(r.eligible).toBe(false); expect(r.reasons).toHaveLength(3);
    expect(checkEligibility({ cgpa: 0, backlogs: 99, branch: 'X' }, { minCgpa: null, maxBacklogs: null, eligibleBranches: [] }).eligible).toBe(true);
  });
});

describe('validators', () => {
  it('signup is strict: role cannot be supplied', () => {
    const base = { email: 'a@b.co', password: 'longenough', firstName: 'A', lastName: 'B', rollNumber: '1', branch: 'cse', year: 1 };
    expect(signupSchema.safeParse(base).success).toBe(true);
    expect(signupSchema.safeParse({ ...base, role: 'ADMIN' }).success).toBe(false);
    expect(signupSchema.parse(base).branch).toBe('CSE');
  });
  it('passwords > 72 chars are refused (bcrypt silently truncates)', () => {
    expect(signupSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(73), firstName: 'A', lastName: 'B', rollNumber: '1', branch: 'c', year: 1 }).success).toBe(false);
  });
  it('urls must be http(s)', () => {
    expect(studentSelfUpdateSchema.safeParse({ linkedinUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(studentSelfUpdateSchema.safeParse({ linkedinUrl: 'https://linkedin.com/in/x' }).success).toBe(true);
    expect(companyCreateSchema.safeParse({ name: 'A', logoUrl: 'data:text/html,<script>' }).success).toBe(false);
  });
  it('escapeHtml neutralises markup', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  });
});

describe('tip matching', () => {
  const skills = { dsaPct: 20, aptitudePct: 80, communicationPct: 50, domainPct: 50, mockInterviewPct: 10 };
  const tip = (category: any, title: string, belowPct = 60) => ({ category, title, belowPct });
  it('maps HR to the mock-interview score and treats missing skills as 0', () => {
    expect(scoreForCategory(skills, 'HR')).toBe(10);
    expect(scoreForCategory(null, 'DSA')).toBe(0);
  });
  it('keeps only tips below their threshold (strictly), weakest first, ties by title', () => {
    const out = matchTips([tip('APTITUDE', 'a'), tip('COMMUNICATION', 'b', 50), tip('DOMAIN', 'c'), tip('DSA', 'd'), tip('HR', 'e')], skills);
    expect(out.map((t) => t.title)).toEqual(['e', 'd', 'c']); // aptitude 80 and communication 50 (not < 50) are excluded
  });
});
