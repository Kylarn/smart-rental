import { HttpError } from '../utils/helpers.js';
import { config } from '../config.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: 'Endpoint not found' });
}

export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.message,
      details: err.details || undefined,
    });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File is too large (max 6MB)' });
  }
  if (err?.name === 'MulterError') {
    return res.status(400).json({ error: err.message });
  }
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('[error]', err);
  res.status(500).json({
    error: config.env === 'production' ? 'Something went wrong on our end' : err.message,
  });
}
