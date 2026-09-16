/**
 * Paths pino blanks before a log line is written (CLAUDE.md s3: redact anything
 * key-shaped; hard line 6: secrets are never logged). Fastify's default request
 * serializer doesn't log headers or bodies, so these are a second line of
 * defence for anything that logs a request, an error or an object by hand.
 */
export const LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-job-secret"]',
  "headers.authorization",
  'headers["x-job-secret"]',
  "*.key",
  "*.secret",
  "*.apiKey",
  "*.apiSecret",
  "*.password",
  "*.accessToken",
  "*.masterKey",
];
