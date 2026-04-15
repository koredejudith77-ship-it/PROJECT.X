import redis from '../lib/redis.js';

const WINDOW_SEC = 10;
const MAX_BIDS = 3;

export async function bidRateLimiter(req, res, next) {
  const userId = req.user?.id;
  if (!userId) return next();

  const key = `rate:bid:${userId}`;
  const current = await redis.get(key);
  const count = current ? parseInt(current) : 0;

  if (count >= MAX_BIDS) {
    return res.status(429).json({ error: `Too many bids. Wait ${WINDOW_SEC} seconds.` });
  }

  const multi = redis.multi();
  multi.incr(key);
  if (count === 0) multi.expire(key, WINDOW_SEC);
  await multi.exec();

  next();
}
