import Redis from 'ioredis';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
if (!redisUrl) console.error('❌ Missing UPSTASH_REDIS_REST_URL');

const redis = new Redis(redisUrl);

redis.on('connect', () => console.log('✅ Redis connected'));
redis.on('error', (err) => console.error('❌ Redis error:', err));

export default redis;
