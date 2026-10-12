import { HttpError } from '../utils/helpers.js';
import { config } from '../config.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: 'Endpoint not found' });
}

export function errorHandler(err, req, res, _next) {
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
  if (err?.name === 'SyntaxError' && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON in request body' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON in request body' });
  }
  if (err?.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message || 'Bad request' });
  }
  const isProd = config.env === 'production';
  if (isProd) {
    console.error('[error]', {
      method: req.method,
      url: req.originalUrl || req.url,
      name: err?.name,
      code: err?.code,
      status: err?.status,
      message: err?.message,
    });
  } else {
    console.error('[error]', err);
  }
  res.status(500).json({
    error: isProd ? 'Something went wrong on our end' : err.message,
  });
}
