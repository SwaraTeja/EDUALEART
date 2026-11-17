import * as dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const PLACEHOLDER = /^(change-?me|replace-?with|your-|xxx|sk-ant-x)/i;

const secret = (name: string) =>
  z
    .string({ required_error: `${name} is required` })
    .min(32, `${name} must be at least 32 characters (generate one with: openssl rand -hex 48)`)
    .refine((v) => !PLACEHOLDER.test(v), `${name} is still a placeholder value — generate a real secret`);

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    // One or more comma-separated browser origins allowed by CORS.
    FRONTEND_URL: z.string().default('http://localhost:3000'),
    TRUST_PROXY: bool.default('false'),

    DATABASE_URL: z.string({ required_error: 'DATABASE_URL is required' }).min(1),

    JWT_SECRET: secret('JWT_SECRET'),
    JWT_REFRESH_SECRET: secret('JWT_REFRESH_SECRET'),
    JWT_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

    // Server-side only. NEVER send this to the frontend/browser.
    CLAUDE_API_KEY: z.string().default(''),
    CLAUDE_MODEL: z.string().default('claude-sonnet-4-6'),

    S3_ENDPOINT: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_PUBLIC_URL: z.string().default(''),

    EMAIL_FROM: z.string().default('noreply@edualert.app'),
    SENDGRID_API_KEY: z.string().optional(),

    CERTIFICATE_BASE_URL: z.string().default(''),
  })
  .refine((e) => e.JWT_SECRET !== e.JWT_REFRESH_SECRET, {
    message: 'JWT_SECRET and JWT_REFRESH_SECRET must be different',
    path: ['JWT_REFRESH_SECRET'],
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${msg}\n(see backend/.env.example)`);
}

const e = parsed.data;
const origins = e.FRONTEND_URL.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

if (e.NODE_ENV === 'production') {
  if (origins.some((o) => !o.startsWith('https://'))) {
    // Not fatal (an internal http origin behind a TLS terminator is legitimate) but worth surfacing.
    console.warn('[config] FRONTEND_URL contains non-https origins in production');
  }
}

export const env = {
  ...e,
  CORS_ORIGINS: origins,
  /** Origin used when building links in emails (first configured origin). */
  APP_URL: origins[0] ?? 'http://localhost:3000',
  IS_PROD: e.NODE_ENV === 'production',
  EMAIL_ENABLED: Boolean(e.SENDGRID_API_KEY),
  S3_ENABLED: Boolean(e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY),
} as const;
