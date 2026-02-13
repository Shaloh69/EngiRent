import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('5000'),
  API_VERSION: z.string().default('v1'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRE: z.string().default('7d'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRE: z.string().default('30d'),

  // ML Service
  ML_SERVICE_URL: z.string().url().default('http://localhost:8001'),
  ML_SERVICE_API_KEY: z.string().optional(),

  // GCash (optional in development)
  GCASH_API_URL: z.string().url().optional(),
  GCASH_MERCHANT_ID: z.string().optional(),
  GCASH_SECRET_KEY: z.string().optional(),
  GCASH_PUBLIC_KEY: z.string().optional(),

  // AWS S3 (optional in development)
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET_NAME: z.string().optional(),

  // Frontend URLs
  CLIENT_WEB_URL: z.string().url().default('http://localhost:3000'),
  CLIENT_MOBILE_URL: z.string().url().default('http://localhost:3000'),

  // Kiosk
  KIOSK_RASPBERRY_PI_URL: z.string().optional(),
  KIOSK_WEBHOOK_SECRET: z.string().optional(),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('100'),

  // File Upload
  MAX_FILE_SIZE: z.string().default('10485760'),
  ALLOWED_FILE_TYPES: z.string().default('image/jpeg,image/png,image/jpg,image/webp'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

type EnvConfig = z.infer<typeof envSchema>;

let env: EnvConfig;

try {
  env = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ Invalid environment variables:');
    error.errors.forEach((err) => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
    process.exit(1);
  }
  throw error;
}

export default env;
