import { get } from '../db/index.js';

export function setting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

export function settingBool(key, fallback = true) {
  const value = setting(key, null);
  if (value === null) return fallback;
  return value === 'true' || value === '1';
}
