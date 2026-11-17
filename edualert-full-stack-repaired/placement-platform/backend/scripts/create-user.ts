/**
 * Provision a privileged account (TPC officer / mentor / admin) out-of-band. This is how the FIRST admin
 * is created; afterwards admins can use POST /api/admin/users.
 *
 *   npm run user:create -- --email admin@college.edu --first Asha --last Rao --role ADMIN
 *
 * No password is typed or stored in shell history: the script creates the account without a password and
 * prints (or e-mails, if SendGrid is configured) a single-use set-password link valid for 72 hours.
 */
import { PrismaClient } from '@prisma/client';
import { provisionSetPasswordLink } from '../src/lib/provision.js';
import { adminCreateUserSchema } from '../src/utils/validator.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const parsed = adminCreateUserSchema.safeParse({ email: arg('email'), firstName: arg('first'), lastName: arg('last'), role: arg('role') });
  if (!parsed.success) {
    console.error('Usage: npm run user:create -- --email <e> --first <name> --last <name> --role ADMIN|TPC_OFFICER|MENTOR');
    console.error(parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
    process.exit(1);
  }
  const d = parsed.data;
  const prisma = new PrismaClient();
  try {
    if (await prisma.user.findUnique({ where: { email: d.email } })) throw new Error(`A user with ${d.email} already exists`);
    const user = await prisma.user.create({
      data: {
        email: d.email, firstName: d.firstName, lastName: d.lastName, role: d.role,
        ...(d.role === 'MENTOR' ? { mentor: { create: {} } } : {}),
      },
    });
    const link = await provisionSetPasswordLink(user, console);
    console.log(`Created ${d.role} ${user.email} (id ${user.id}).`);
    console.log(link.emailed ? 'A set-password link was e-mailed to the user.' : `Set-password link (single use, 72h):\n${link.setPasswordUrl}`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
