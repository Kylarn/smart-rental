export function rateLimit({ windowMs, max, keyPrefix }) {
  const hits = new Map();

  const prune = (now) => {
    if (hits.size <= 5000) return;
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  };

  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${req.ip}`;
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      prune(now);
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    return next();
  };
}

export function envMax(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '' || Number.isNaN(Number(raw))) return fallback;
  return Number(raw);
}

export function authRateLimits(config) {
  const prod = config.env === 'production';
  return {
    login: { windowMs: 15 * 60 * 1000, max: envMax('RATE_LIMIT_LOGIN_MAX', prod ? 20 : 1000), keyPrefix: 'login' },
    register: { windowMs: 15 * 60 * 1000, max: envMax('RATE_LIMIT_REGISTER_MAX', prod ? 10 : 1000), keyPrefix: 'register' },
    initiate: { windowMs: 5 * 60 * 1000, max: envMax('RATE_LIMIT_INITIATE_MAX', prod ? 8 : 5000), keyPrefix: 'initiate' },
    upload: { windowMs: 10 * 60 * 1000, max: envMax('RATE_LIMIT_UPLOAD_MAX', prod ? 60 : 5000), keyPrefix: 'upload' },
    callback: { windowMs: 5 * 60 * 1000, max: envMax('RATE_LIMIT_CALLBACK_MAX', 600), keyPrefix: 'callback' },
  };
}