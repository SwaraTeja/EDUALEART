import { env } from '../config/env.js';
import { passwordFingerprint, signToken } from './tokens.js';
import { sendSetPasswordEmail } from '../services/email.js';

export const SET_PASSWORD_HOURS = 72;

/**
 * Accounts created by an officer/admin have no password. They get a single-use, time-limited link
 * (same mechanism as password reset) to choose one. The link is e-mailed; only when e-mail is not
 * configured is it returned to the (already authenticated, privileged) caller so they can hand it over.
 */
export async function provisionSetPasswordLink(
  user: { id: string; email: string; firstName: string; passwordHash: string | null },
  log: { error: (...a: unknown[]) => void }
): Promise<{ emailed: boolean; setPasswordUrl?: string }> {
  const token = signToken('reset', { id: user.id, ph: passwordFingerprint(user.passwordHash) }, `${SET_PASSWORD_HOURS}h`);
  const url = `${env.APP_URL}/reset?token=${encodeURIComponent(token)}`;
  try {
    const emailed = await sendSetPasswordEmail(user.email, user.firstName, url, SET_PASSWORD_HOURS);
    return emailed ? { emailed: true } : { emailed: false, setPasswordUrl: url };
  } catch (err) {
    log.error(err);
    return { emailed: false, setPasswordUrl: url };
  }
}
