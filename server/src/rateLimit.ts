import type { RequestHandler } from "express";

type IpBucket = {
  count: number;
  resetAt: number;
};

const ipBuckets = new Map<string, IpBucket>();

export const createRestRateLimit = (maxRequests: number, windowMs: number): RequestHandler => {
  return (req, res, next) => {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const existing = ipBuckets.get(ip);

    if (!existing || existing.resetAt <= now) {
      ipBuckets.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (existing.count >= maxRequests) {
      res.status(429).json({ error: "Too many requests", code: "RATE_LIMITED" });
      return;
    }

    existing.count += 1;
    next();
  };
};

export type TokenBucket = {
  tokens: number;
  lastRefill: number;
};

export const createWsTokenBucket = (
  capacity: number,
  refillPerSecond: number
): { bucket: TokenBucket; consume: () => boolean } => {
  const bucket: TokenBucket = {
    tokens: capacity,
    lastRefill: Date.now()
  };

  const consume = (): boolean => {
    const now = Date.now();
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    const refill = elapsedSec * refillPerSecond;
    bucket.tokens = Math.min(capacity, bucket.tokens + refill);
    bucket.lastRefill = now;
    if (bucket.tokens < 1) {
      return false;
    }
    bucket.tokens -= 1;
    return true;
  };

  return { bucket, consume };
};
