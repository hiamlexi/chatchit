const path = require('path');
const express = require('express');

const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_MESSAGES_PER_ROOM = 100;
const MAX_TEXT_LENGTH = 500;
const RATE_WINDOW_SECONDS = 60;

function bearerToken(req) {
  const header = req.get('Authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function internalError(res, err) {
  console.error(err.message);
  res.status(500).json({ error: 'internal error' });
}

async function overLimit(redis, scope, id, limit) {
  const windowId = Math.floor(Date.now() / 1000 / RATE_WINDOW_SECONDS);
  const key = `ratelimit:${scope}:${id}:${windowId}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, RATE_WINDOW_SECONDS);
    return count > limit;
  } catch (err) {
    console.error('rate limit check failed:', err.message);
    return false;
  }
}

function tooMany(res) {
  res.set('Retry-After', String(RATE_WINDOW_SECONDS));
  res.status(429).json({ error: 'too many requests, try again in a minute' });
}

function createApp({
  redis,
  userServiceUrl,
  userServiceTimeoutMs = 3000,
  authLimit = 10,
  postLimit = 30,
  fetchImpl = fetch,
  log = console.log,
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(path.join(__dirname, 'public')));
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

  async function forwardToUserService(path, req, res) {
    if (await overLimit(redis, 'auth', req.ip, authLimit)) return tooMany(res);
    try {
      const response = await fetchImpl(`${userServiceUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body || {}),
        signal: AbortSignal.timeout(userServiceTimeoutMs),
      });
      res.status(response.status).json(await response.json());
    } catch (err) {
      console.error('user-service call failed:', err.message);
      res.status(503).json({ error: 'user-service unavailable' });
    }
  }
  app.post('/register', (req, res) => forwardToUserService('/register', req, res));
  app.post('/login', (req, res) => forwardToUserService('/login', req, res));

  async function authenticate(token, res) {
    try {
      const response = await fetchImpl(`${userServiceUrl}/validate`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(userServiceTimeoutMs),
      });
      if (response.status === 401) {
        res.status(401).json({ error: 'invalid or expired token' });
        return null;
      }
      if (!response.ok) throw new Error(`validate returned ${response.status}`);
      return (await response.json()).username;
    } catch (err) {
      console.error('user-service call failed:', err.message);
      res.status(503).json({ error: 'user-service unavailable' });
      return null;
    }
  }

  app.post('/messages', async (req, res) => {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'missing token' });

    const { room, text } = req.body || {};
    if (typeof room !== 'string' || !ROOM_PATTERN.test(room)) {
      return res
        .status(400)
        .json({ error: 'room must be 1-32 characters: letters, digits, _ or -' });
    }
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: `text must be 1-${MAX_TEXT_LENGTH} characters` });
    }

    const user = await authenticate(token, res);
    if (!user) return;
    if (await overLimit(redis, 'post', user, postLimit)) return tooMany(res);

    try {
      const message = { user, text: text.trim(), ts: Date.now() };
      const key = `room:${room}`;
      await redis.rpush(key, JSON.stringify(message));
      await redis.ltrim(key, -MAX_MESSAGES_PER_ROOM, -1);
      res.status(201).json(message);
    } catch (err) {
      internalError(res, err);
    }
  });

  app.get('/messages/:room', async (req, res) => {
    const { room } = req.params;
    if (!ROOM_PATTERN.test(room)) return res.status(400).json({ error: 'invalid room name' });
    try {
      const items = await redis.lrange(`room:${room}`, 0, -1);
      res.json(items.map((item) => JSON.parse(item)));
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
