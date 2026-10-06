"""Application settings, loaded from environment (12-factor style)."""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Tests set this to allow constructing Settings without real secrets.
ALLOW_MISSING_SECRETS_ENV = "GATEWAY_ALLOW_MISSING_SECRETS"


class Settings(BaseSettings):
    """All runtime configuration. Values come from the environment / .env file."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ------------------------------------------------------------------ LiteLLM
    LITELLM_BASE_URL: str = "http://litellm:4000"
    LITELLM_MASTER_KEY: str = Field(default="", min_length=1)

    # ------------------------------------------------------------------ database
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://gateway:gateway@localhost:5432/gateway",
    )

    # ------------------------------------------------------------------ redis
    REDIS_URL: str = "redis://localhost:6379/1"

    # ------------------------------------------------------------------ auth
    JWT_SECRET: str = Field(default="", min_length=1)
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # ------------------------------------------------------------------ billing
    MARKUP: float = 2.5
    SIGNUP_BONUS_CREDIT: float = 5.0

    # ------------------------------------------------------------------ limits
    RATE_LIMIT_PER_MIN: int = 60
    DAILY_MESSAGE_CAP: int = 200

    # ------------------------------------------------------------------ misc
    LOG_LEVEL: str = "INFO"
    ENVIRONMENT: Literal["dev", "prod"] = "dev"

    @field_validator("LITELLM_MASTER_KEY", "JWT_SECRET")
    @classmethod
    def _require_secrets(cls, v: str, info) -> str:  # noqa: ANN001
        """Fail fast when a required secret is missing.

        Tests opt out by setting GATEWAY_ALLOW_MISSING_SECRETS=1.
        """
        if not v and os.environ.get(ALLOW_MISSING_SECRETS_ENV) != "1":
            raise ValueError(
                f"{info.field_name} must be set (see .env.example)"
            )
        return v or "test-only-placeholder"

    @field_validator("MARKUP")
    @classmethod
    def _markup_sane(cls, v: float) -> float:
        """Markup below 1.0 would sell below cost — refuse it."""
        if v < 1.0:
            raise ValueError("MARKUP must be >= 1.0")
        return v


@lru_cache
def get_settings() -> Settings:
    """Return the cached singleton Settings instance."""
    return Settings()


def configure_logging(level: str = "INFO") -> None:
    """Configure root logging with a structured single-line format."""
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        force=True,
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
