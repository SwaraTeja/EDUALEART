import fp from 'fastify-plugin';
import AWS from 'aws-sdk';
import { env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** null when S3 is not configured (routes must check and return 503). */
    s3: AWS.S3 | null;
  }
}

/** Works with AWS S3 and S3-compatible stores (Cloudflare R2, MinIO) via S3_ENDPOINT. */
export default fp(async (fastify) => {
  const s3 = env.S3_ENABLED
    ? new AWS.S3({
        endpoint: env.S3_ENDPOINT || undefined,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        s3ForcePathStyle: Boolean(env.S3_ENDPOINT),
        signatureVersion: 'v4',
      })
    : null;
  fastify.decorate('s3', s3);
});
