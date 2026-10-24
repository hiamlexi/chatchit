const Redis = require('ioredis');
const { createApp } = require('./app');

const PORT = parseInt(process.env.PORT || '3000', 10);
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 1,
});
redis.on('error', (err) => console.error('redis error:', err.message));

const app = createApp({ redis, userServiceUrl: USER_SERVICE_URL });

const server = app.listen(PORT, () =>
  console.log(`message-service listening on ${PORT}, user-service at ${USER_SERVICE_URL}`),
);

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down');
  server.close(() => redis.quit().finally(() => process.exit(0)));
});
