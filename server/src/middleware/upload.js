import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config.js';

fs.mkdirSync(config.uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf']);

const SIGNATURES = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/gif': (b) => b.length > 3 && b.slice(0, 3).toString('ascii') === 'GIF',
  'image/webp': (b) => b.length > 12 && b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP',
  'application/pdf': (b) => b.length > 5 && b.slice(0, 5).toString('ascii') === '%PDF-',
};

export function contentMatchesType(buffer, mimetype) {
  const check = SIGNATURES[mimetype];
  if (!check) return false;
  return check(buffer);
}

export const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED.has(file.mimetype)) {
      const err = new Error('Only images (JPEG, PNG, WEBP, GIF) and PDF files are allowed');
      err.status = 400;
      return cb(err);
    }
    if (!ALLOWED_EXT.has(ext)) {
      const err = new Error('File extension not allowed. Use .jpg, .jpeg, .png, .webp, .gif or .pdf');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

export function fileUrl(filename) {
  return `/uploads/${filename}`;
}
