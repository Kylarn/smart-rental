import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { get } from '../db/index.js';
import { unauthorized, forbidden, asyncHandler } from '../utils/helpers.js';

export const COOKIE_NAME = 'sr_token';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.full_name },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
  });
}

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = req.cookies?.[COOKIE_NAME] || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) throw unauthorized();
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  const user = get('SELECT id, role, full_name, email, phone, status, avatar_url, county, id_number, bio FROM users WHERE id = ?', [payload.id]);
  if (!user) throw unauthorized('Account no longer exists');
  if (user.status === 'suspended') throw forbidden('This account has been suspended. Contact support.');
  req.user = user;
  next();
});

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      const user = get('SELECT id, role, full_name, email, phone, status, avatar_url, county, id_number, bio FROM users WHERE id = ?', [payload.id]);
      if (user && user.status === 'active') req.user = user;
    } catch {
      /* ignore */
    }
  }
  next();
});
