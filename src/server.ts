// Load environment variables and error monitoring FIRST, before any other imports
import './instrument';
import dotenv from 'dotenv';
dotenv.config();
import * as Sentry from '@sentry/node';

import express, { Application, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import { connectDB } from './config/database';
import { rateLimit } from './middleware/rateLimit.middleware';

// Configure Cloudinary after env vars are loaded
import { configureCloudinary } from './services/cloudinary.service';
configureCloudinary();

// Import routes
import authRoutes from './routes/auth.routes';
import profileRoutes from './routes/profile.routes';
import chatRoutes from './routes/chat.routes';
import notificationRoutes from './routes/notification.routes';
import coinsRoutes from './routes/coins.routes';
import datesRoutes from './routes/dates.routes';
import safetyRoutes from './routes/safety.routes';
import settingsRoutes from './routes/settings.routes';
import plusRoutes from './routes/plus.routes';
import waitlistRoutes from './routes/waitlist.routes';
import adminRoutes from './routes/admin.routes';

// Import scheduled jobs
import { schedulePurgeDeletedAccounts } from './jobs/purgeDeletedAccounts';

// Import socket handler
import { initializeSocketIO } from './socket/chat.socket';
import { setIO } from './socket/io';

const isProduction = process.env.NODE_ENV === 'production';

// Browser origins allowed to call the API (comma-separated). The native apps send no Origin.
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
if (isProduction && (corsOrigins.length === 0 || corsOrigins.includes('*'))) {
  console.error('TRUST_PROXY must list the web app origins in production, e.g. https://relun.chat');
  process.exit(1);
}
const corsOrigin = corsOrigins.length > 0 ? corsOrigins : '*';

const app: Application = express();
app.disable('x-powered-by');
// Number of proxies in front of the API (load balancer, nginx), so req.ip is the client's
// address for rate limiting. Set TRUST_PROXY=0 when clients connect directly.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
const httpServer = createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    credentials: true,
  },
  maxHttpBufferSize: 1e6,
});

initializeSocketIO(io);
setIO(io);

// Middleware
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 300 }));
app.use(
  express.json({
    limit: '100kb',
    // Paystack webhooks are signed over the exact bytes received.
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Health check, polled by the uptime monitor: 503 when the database is unreachable.
app.get('/health', (_req: Request, res: Response) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({
    status: dbUp ? 'ok' : 'degraded',
    database: dbUp ? 'up' : 'down',
    timestamp: new Date().toISOString(),
    service: 'Relun API',
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/coins', coinsRoutes);
app.use('/api/dates', datesRoutes);
app.use('/api/safety', safetyRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/plus', plusRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/admin', adminRoutes);

// Reports unhandled route errors to Sentry (a no-op when SENTRY_DSN is unset).
Sentry.setupExpressErrorHandler(app);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use((err: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
  // Bad uploads and malformed bodies are the client's fault, not a server error.
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'That photo is too large. Try one under 20 MB.' : err.message;
    res.status(400).json({ error: message });
    return;
  }
  if (err.message?.startsWith('That file isn’t a photo')) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start server
const PORT = process.env.PORT || 9000;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    schedulePurgeDeletedAccounts();

    httpServer.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════╗
║   Relun API Server                    ║
║   Running on port ${PORT}                ║
║   Environment: ${process.env.NODE_ENV || 'development'}            ║
╚═══════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();


export default app;