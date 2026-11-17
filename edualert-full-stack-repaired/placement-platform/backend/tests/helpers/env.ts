// Runs before any test file imports src/config/env.ts.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret-0123456789abcdef0123456789abcdef';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-fedcba9876543210fedcba9876543210';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.CLAUDE_API_KEY = '';
process.env.SENDGRID_API_KEY = '';
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:example@localhost:5432/placement_test';
