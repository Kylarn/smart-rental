const DEV_JWT_SECRET = 'smart-rentals-dev-secret-change-me';

export function validateEnvConfig(env, values = {}) {
  const errors = [];
  const warnings = [];

  if (env !== 'production') return { errors, warnings };

  const jwtSecret = values.jwtSecret || process.env.JWT_SECRET;
  if (!jwtSecret) {
    errors.push('JWT_SECRET must be set in production');
  } else if (jwtSecret === DEV_JWT_SECRET) {
    errors.push('JWT_SECRET must not use the development default in production');
  } else if (jwtSecret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters long in production');
  }

  if (process.env.COOKIE_SECURE !== '1') {
    errors.push('COOKIE_SECURE must be set to 1 in production (secure, HTTPS-only cookies)');
  }

  const hasMpesa = [process.env.MPESA_CONSUMER_KEY, process.env.MPESA_CONSUMER_SECRET, process.env.MPESA_SHORTCODE, process.env.MPESA_PASSKEY].some(Boolean);
  if (hasMpesa || process.env.MPESA_ENV || process.env.MPESA_CALLBACK_URL) {
    if (process.env.MPESA_ENV !== 'production') {
      errors.push('MPESA_ENV must be set to "production" when M-Pesa credentials are configured in production');
    }
    if (process.env.MPESA_ENV === 'production' && (!process.env.MPESA_CALLBACK_URL || !process.env.MPESA_CALLBACK_URL.startsWith('https://'))) {
      errors.push('MPESA_CALLBACK_URL must be a public HTTPS URL in production');
    }
    if (!hasMpesa) {
      warnings.push('M-Pesa credentials are incomplete: live STK push will remain disabled');
    }
  } else {
    warnings.push('M-Pesa is not configured: STK push payments will be disabled in production (manual payments only)');
  }

  if (!process.env.CLIENT_ORIGIN) {
    warnings.push('CLIENT_ORIGIN is not set; CORS will allow no cross-origin frontends (same-origin SPA still works)');
  }

  return { errors, warnings };
}