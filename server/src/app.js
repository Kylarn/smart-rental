import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import { rateLimit, authRateLimits } from './middleware/rateLimit.js';

import authRoutes from './routes/auth.js';
import activationRoutes from './routes/activation.js';
import smsRoutes from './routes/sms.js';
import marketRoutes from './routes/market.js';
import propertyRoutes from './routes/properties.js';
import unitRoutes from './routes/units.js';
import tenantRoutes from './routes/tenants.js';
import leaseRoutes from './routes/leases.js';
import applicationRoutes from './routes/applications.js';
import paymentRoutes from './routes/payments.js';
import maintenanceRoutes from './routes/maintenance.js';
import expenseRoutes from './routes/expenses.js';
import utilityBillRoutes from './routes/utilityBills.js';
import communicationRoutes from './routes/communications.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import adminRoutes from './routes/admin.js';
import uploadRoutes from './routes/uploads.js';

export function createApp() {
  getDb();
  fs.mkdirSync(config.uploadsDir, { recursive: true });

  const app = express();
  app.set('trust proxy', true);

  const trustedOrigins =
    config.env === 'production'
      ? config.clientOrigin.split(',').map((o) => o.trim()).filter(Boolean)
      : [config.clientOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173'];

  app.use(cors({ origin: trustedOrigins, credentials: true }));
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        // Preserve the exact bytes so webhook handlers can verify provider signatures.
        req.rawBody = buf;
      },
    })
  );
  app.use(cookieParser());

  app.use(
    '/uploads',
    express.static(config.uploadsDir, {
      maxAge: '7d',
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      },
    })
  );

  const limits = authRateLimits(config);
  app.use('/api/auth/login', rateLimit(limits.login));
  app.use('/api/auth/register', rateLimit(limits.register));
  app.use('/api/auth/activation', rateLimit(limits.activation));
  app.use('/api/payments/mpesa/callback', rateLimit(limits.callback));
  app.use('/api/payments/initiate', rateLimit(limits.initiate));
  app.use('/api/uploads', rateLimit(limits.upload));

  app.get('/api/health', (_req, res) =>
    res.json({ ok: true, service: 'smart-rentals', time: new Date().toISOString() })
  );

  app.use('/api/auth', activationRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/market', marketRoutes);
  app.use('/api/sms', smsRoutes);
  app.use('/api/properties', propertyRoutes);
  app.use('/api/units', unitRoutes);
  app.use('/api/tenants', tenantRoutes);
  app.use('/api/leases', leaseRoutes);
  app.use('/api/applications', applicationRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/maintenance', maintenanceRoutes);
  app.use('/api/expenses', expenseRoutes);
  app.use('/api/utility-bills', utilityBillRoutes);
  app.use('/api', communicationRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/uploads', uploadRoutes);

  app.use('/api', notFoundHandler);

  if (fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist));
    app.get('*', (req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
