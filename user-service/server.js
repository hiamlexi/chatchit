const Redis = require('ioredis');
const { createApp } = require('./app');

const PORT = parseInt(process.env.PORT || '3001', 10);

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 1,
});
redis.on('error', (err) => console.error('redis error:', err.message));

const app = createApp({
  redis,
  tokenTtl: parseInt(process.env.TOKEN_TTL || '3600', 10),
});

const server = app.listen(PORT, () => console.log(`user-service listening on ${PORT}`));

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down');
  server.close(() => redis.quit().finally(() => process.exit(0)));
});
