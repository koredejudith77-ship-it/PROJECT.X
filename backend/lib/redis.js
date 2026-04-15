import Redis from 'ioredis';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
let redis = null;

if (redisUrl) {
  redis = new Redis(redisUrl);
  redis.on('connect', () => console.log('✅ Redis connected'));
  redis.on('error', (err) => console.error('❌ Redis error:', err));
} else {
  console.warn('⚠️ UPSTASH_REDIS_REST_URL not set. Redis disabled.');
}

export default redis;
