"""Rate limiting: 60 req/min/user via Redis, plus a daily message cap.

The per-minute counter is a Redis fixed window (INCR + EXPIRE). The daily cap
is a Redis date-keyed counter so it survives API restarts and multiple workers.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status

from .config import get_settings

logger = logging.getLogger(__name__)


class RateLimiter:
    """Redis-backed fixed-window rate limiter with a daily cap."""

    def __init__(self) -> None:
        """Create an unconnected limiter; call connect() before use."""
        self._redis = None

    async def connect(self, redis_url: str) -> None:
        """Open the Redis connection (called during app startup)."""
        import redis.asyncio as aioredis

        self._redis = aioredis.from_url(
            redis_url, decode_responses=True, socket_connect_timeout=3
        )
        await self._redis.ping()

    async def close(self) -> None:
        """Close the Redis connection."""
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None

    async def check(self, user_id: uuid.UUID) -> None:
        """Enforce per-minute and daily limits for the user.

        Raises:
            HTTPException: 429 when the per-minute limit is hit, 429 with a
                daily message when the daily cap is hit.
        """
        if self._redis is None:
            # Fail open with a warning if Redis is down; rate limiting is
            # defense-in-depth, not correctness-critical.
            logger.warning("rate limiter unavailable - skipping checks")
            return

        settings = get_settings()
        minute_key = f"ratelimit:{user_id}:{int(datetime.now(timezone.utc).timestamp()) // 60}"
        day_key = f"daily:{user_id}:{datetime.now(timezone.utc).strftime('%Y%m%d')}"

        pipe = self._redis.pipeline()
        pipe.incr(minute_key)
        pipe.expire(minute_key, 60)
        pipe.incr(day_key)
        pipe.expire(day_key, 172_800)  # 48h, covers UTC day rollover
        minute_count, _, day_count, _ = await pipe.execute()

        if minute_count > settings.RATE_LIMIT_PER_MIN:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Please slow down.",
            )
        if day_count > settings.DAILY_MESSAGE_CAP:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Daily message cap reached. Try again tomorrow.",
            )
