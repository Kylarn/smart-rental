import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function badRequest(message, details = null) {
  return new HttpError(400, message, details);
}

export function unauthorized(message = 'Authentication required') {
  return new HttpError(401, message);
}

export function forbidden(message = 'You do not have permission to do that') {
  return new HttpError(403, message);
}

export function notFound(message = 'Resource not found') {
  return new HttpError(404, message);
}

export function conflict(message) {
  return new HttpError(409, message);
}

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function parseJson(value, fallback = []) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function randomId(prefix = '') {
  return `${prefix}${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

const KE_PHONE = /^(\+?254|0)(7|1)\d{8}$/;

export function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/[\s\-()]/g, '');
  if (!KE_PHONE.test(digits)) return null;
  const local = digits.replace(/^\+?254/, '0');
  return local;
}

export function formatKes(amount) {
  return `KES ${Number(amount || 0).toLocaleString('en-KE')}`;
}

export function currentPeriod(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(period) {
  if (!period) return '';
  const [y, m] = period.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-KE', {
    month: 'short',
    year: 'numeric',
  });
}

export function formatDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function daysBetween(a, b) {
  return Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

export function validate(body, rules) {
  const errors = {};
  for (const [field, rule] of Object.entries(rules)) {
    const value = body?.[field];
    if (rule.required && (value === undefined || value === null || String(value).trim() === '')) {
      errors[field] = `${rule.label || field} is required`;
      continue;
    }
    if (value === undefined || value === null || value === '') continue;
    if (rule.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
      errors[field] = `${rule.label || field} must be a valid email`;
    }
    if (rule.type === 'phone' && !normalizePhone(value)) {
      errors[field] = `${rule.label || field} must be a valid Kenyan phone number (e.g. 0712345678)`;
    }
    if (rule.type === 'number' && Number.isNaN(Number(value))) {
      errors[field] = `${rule.label || field} must be a number`;
    }
    if (rule.min !== undefined && Number(value) < rule.min) {
      errors[field] = `${rule.label || field} must be at least ${rule.min}`;
    }
    if (rule.minLength !== undefined && String(value).trim().length < rule.minLength) {
      errors[field] = `${rule.label || field} must be at least ${rule.minLength} characters`;
    }
  }
  if (Object.keys(errors).length) {
    const err = badRequest('Please fix the highlighted fields', errors);
    err.validation = errors;
    throw err;
  }
  return body;
}
