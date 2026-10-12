import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth';
import antennaRoutes from './routes/antennas';
import historyRoutes from './routes/history';
import weatherRoutes from './routes/weather';
import { isAllowedOrigin } from './config';
import { apiLimiter } from './lib/rateLimits';

export function createApp() {
  const app = express();

  // Render terminates TLS in front of us; trust exactly one proxy hop so req.ip
  // (used by the rate limiter) is the real client address and cannot be spoofed.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        // Requests without an Origin header (curl, health checks) are not CORS requests.
        callback(null, !origin || isAllowedOrigin(origin));
      },
    })
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.status(200).send('OK');
  });

  app.use('/api', apiLimiter);
  app.use('/api/auth', authRoutes);
  app.use('/api/antennas', antennaRoutes);
  app.use('/api/history', historyRoutes);
  app.use('/api/weather', weatherRoutes);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    // Malformed JSON or an oversized body from express.json().
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body too large' });
      return;
    }

    console.error('Unhandled error:', err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Server error' });
  };
  app.use(errorHandler);

  return app;
}
