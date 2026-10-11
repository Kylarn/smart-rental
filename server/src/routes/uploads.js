import fs from 'node:fs';
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { upload, fileUrl, contentMatchesType } from '../middleware/upload.js';
import { badRequest } from '../utils/helpers.js';

const router = express.Router();

router.post(
  '/',
  requireAuth,
  upload.array('files', 10),
  (req, res) => {
    if (!req.files?.length) throw badRequest('No files received');

    const invalid = [];
    for (const f of req.files) {
      const buf = fs.readFileSync(f.path);
      if (!contentMatchesType(buf, f.mimetype)) {
        fs.rmSync(f.path, { force: true });
        invalid.push(f.originalname);
      }
    }
    if (invalid.length) {
      throw badRequest('The file contents do not match their type and were rejected', { files: invalid });
    }

    res.status(201).json({ files: req.files.map((f) => fileUrl(f.filename)) });
  }
);

export default router;
