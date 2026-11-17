export interface EligibilityStudent { cgpa: number; backlogs: number; branch: string }
export interface EligibilityCompany { minCgpa: number | null; maxBacklogs: number | null; eligibleBranches: string[] }

/** Server-side drive-eligibility rules. Returns every reason a student fails, so the UI can explain it. */
export function checkEligibility(s: EligibilityStudent, c: EligibilityCompany): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (c.minCgpa != null && s.cgpa < c.minCgpa) reasons.push(`Minimum CGPA ${c.minCgpa} required`);
  if (c.maxBacklogs != null && s.backlogs > c.maxBacklogs) reasons.push(`At most ${c.maxBacklogs} backlog(s) allowed`);
  if (c.eligibleBranches.length > 0 && !c.eligibleBranches.map((b) => b.toUpperCase()).includes(s.branch.toUpperCase())) {
    reasons.push(`Open to ${c.eligibleBranches.join(', ')} only`);
  }
  return { eligible: reasons.length === 0, reasons };
}
