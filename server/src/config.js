import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEnvConfig } from './utils/configGuard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(path.resolve(__dirname, '..', '..', '.env'));
} catch {
  /* no .env file — rely on shell env + defaults */
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || 'smart-rentals-dev-secret-change-me',
  jwtExpiresIn: '7d',
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data.db'),
  uploadsDir: process.env.UPLOADS_DIR || path.resolve(__dirname, '..', '..', 'uploads'),
  clientDist: path.resolve(__dirname, '..', '..', 'client', 'dist'),
  cookieSecure: process.env.COOKIE_SECURE === '1',
  maxUploadBytes: 6 * 1024 * 1024,
};

const { errors, warnings } = validateEnvConfig(config.env, { jwtSecret: config.jwtSecret });
warnings.forEach((w) => console.warn(`[config] WARNING: ${w}`));
if (errors.length) {
  console.error('[config] Refusing to start in production with unsafe configuration:');
  errors.forEach((e) => console.error(`  - ${e}`));
  throw new Error(`Unsafe production configuration: ${errors.join('; ')}`);
}
