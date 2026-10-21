// Sentry has to start before express, http and mongoose are loaded so it can
// instrument them, so server.ts imports this first. It reads its own env.
import 'dotenv/config';
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    // Bodies carry OTPs and messages, query strings carry coordinates: collect none of it.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { deny: ['authorization', 'cookie'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
    },
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.2),
    // Controllers catch their own errors and console.error them, so report those too.
    integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
    beforeSend(event) {
      // Never ship tokens, OTPs or message bodies.
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
      }
      return event;
    },
  });
}
