const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 72;

function readCredentials(body) {
  const { username, password } = body || {};
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    return { error: 'username must be 3-32 characters: letters, digits, _ or -' };
  }
  if (
    typeof password !== 'string' ||
    password.length < PASSWORD_MIN ||
    password.length > PASSWORD_MAX
  ) {
    return { error: `password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters` };
  }
  return { username, password };
}

function bearerToken(req) {
  const header = req.get('Authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function internalError(res, err) {
  console.error(err.message);
  res.status(500).json({ error: 'internal error' });
}

function createApp({ redis, tokenTtl = 3600, bcryptRounds = 10, log = console.log }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use((req, _res, next) => {
    log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });

  app.get('/live', (_req, res) => res.json({ status: 'ok' }));

  app.get('/health', async (_req, res) => {
    try {
      await redis.ping();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'redis unavailable' });
    }
  });

  app.post('/register', async (req, res) => {
    const { error, username, password } = readCredentials(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const hash = await bcrypt.hash(password, bcryptRounds);
      const created = await redis.setnx(`user:${username}`, hash);
      if (!created) return res.status(409).json({ error: 'username taken' });
      res.status(201).json({ username });
    } catch (err) {
      internalError(res, err);
    }
  });

  app.post('/login', async (req, res) => {
    const { error, username, password } = readCredentials(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const hash = await redis.get(`user:${username}`);
      if (!hash || !(await bcrypt.compare(password, hash))) {
        return res.status(401).json({ error: 'invalid credentials' });
      }
      const token = crypto.randomUUID();
      await redis.set(`token:${token}`, username, 'EX', tokenTtl);
      res.json({ token, username, expiresIn: tokenTtl });
    } catch (err) {
      internalError(res, err);
    }
  });

  app.get('/validate', async (req, res) => {
    const token = bearerToken(req);
    if (!token) return res.status(400).json({ error: 'bearer token required' });
    try {
      const username = await redis.get(`token:${token}`);
      if (!username) return res.status(401).json({ valid: false });
      res.json({ valid: true, username });
    } catch (err) {
      internalError(res, err);
    }
  });

  app.use((err, _req, res, _next) => {
    if (err.status && err.status < 500)
      return res.status(err.status).json({ error: 'bad request' });
    internalError(res, err);
  });

  return app;
}

module.exports = { createApp };
