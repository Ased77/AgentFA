"""Regression tests for litellm/config.yaml.

These guard the two failure modes that cost the most: a customer-facing model
name that does not exist in `model_list` (every /chat would 400), and a fallback
that points at a model group nobody defined (the chain would silently stop).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml

CONFIG_PATH = Path(__file__).resolve().parents[1] / "litellm" / "config.yaml"

# The only model names the API is allowed to request (app/llm_client.py).
CLIENT_FACING_MODELS = ("agent-pro", "agent-basic")


@pytest.fixture(scope="module")
def config() -> dict[str, Any]:
    return yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))


def _deployments(config: dict[str, Any], model_name: str) -> list[dict[str, Any]]:
    return [
        entry for entry in config["model_list"] if entry["model_name"] == model_name
    ]


def _fallbacks(config: dict[str, Any]) -> dict[str, list[str]]:
    """Flatten router_settings.fallbacks into a plain mapping."""
    flattened: dict[str, list[str]] = {}
    for entry in config["router_settings"]["fallbacks"]:
        flattened.update(entry)
    return flattened


def test_config_is_valid_yaml_and_has_required_sections(config) -> None:
    assert CONFIG_PATH.is_file()
    assert {"model_list", "router_settings", "litellm_settings", "general_settings"} <= set(
        config
    )
    assert config["model_list"], "model_list must not be empty"


def test_client_facing_model_names_exist(config) -> None:
    """agent-pro / agent-basic are the contract with app/llm_client.py."""
    names = {entry["model_name"] for entry in config["model_list"]}
    for model_name in CLIENT_FACING_MODELS:
        assert model_name in names, f"{model_name} is missing from model_list"


def test_every_model_group_has_at_least_one_deployment(config) -> None:
    names = [entry["model_name"] for entry in config["model_list"]]
    for name in set(names):
        assert _deployments(config, name), f"{name} has no deployments"


def test_primary_groups_have_two_keys_for_rotation(config) -> None:
    """Two deployments per remote provider = key rotation / load balancing."""
    for model_name in CLIENT_FACING_MODELS:
        assert len(_deployments(config, model_name)) == 2


def test_every_fallback_target_is_a_defined_model_group(config) -> None:
    names = {entry["model_name"] for entry in config["model_list"]}
    for source, targets in _fallbacks(config).items():
        assert source in names, f"fallback source {source} is not a model group"
        for target in targets:
            assert target in names, f"fallback {source} -> {target} is undefined"


def test_fallback_chains_match_the_documented_order(config) -> None:
    fallbacks = _fallbacks(config)
    assert fallbacks["agent-pro"] == [
        "agent-pro-claude",
        "agent-pro-gemini",
        "agent-pro-ollama",
    ]
    assert fallbacks["agent-basic"] == ["agent-basic-flash", "agent-basic-ollama"]


def test_fallback_chains_end_with_local_ollama(config) -> None:
    """Ollama is the always-on last line of defence."""
    for targets in _fallbacks(config).values():
        assert targets[-1].endswith("-ollama")


def test_retries_and_circuit_breaker_are_configured(config) -> None:
    router = config["router_settings"]
    assert router["num_retries"] >= 1
    assert router["allowed_fails"] >= 1
    assert router["cooldown_time"] >= 1
    assert config["litellm_settings"]["allowed_fails"] >= 1
    assert config["litellm_settings"]["cooldown_time"] >= 1


def test_per_attempt_timeouts_fit_the_25s_customer_deadline(config) -> None:
    """A single attempt must not be able to eat the whole customer budget."""
    for entry in config["model_list"]:
        timeout = entry["litellm_params"]["timeout"]
        assert timeout < 25, f"{entry['model_name']} timeout {timeout}s exceeds 25s"
        stream_timeout = entry["litellm_params"]["stream_timeout"]
        assert stream_timeout <= timeout


def test_remote_groups_budget_for_a_fallback_attempt(config) -> None:
    """2 attempts x per-attempt timeout + 1 fallback attempt must fit in 25s."""
    for model_name in CLIENT_FACING_MODELS:
        per_attempt = max(
            entry["litellm_params"]["timeout"]
            for entry in _deployments(config, model_name)
        )
        assert 2 * per_attempt + per_attempt <= 25


def test_customer_id_is_enforced_on_every_request(config) -> None:
    assert config["litellm_settings"]["enforce_user_param"] is True


def test_callback_points_at_an_instance_not_the_class(config) -> None:
    """A class path makes the proxy fail config loading - must be the instance."""
    callbacks = config["litellm_settings"]["callbacks"]
    assert isinstance(callbacks, str)
    assert callbacks.endswith("proxy_handler_instance")
    assert not callbacks.endswith("GatewayHeaderCallback")


def test_spend_logging_and_cache_are_enabled(config) -> None:
    settings = config["litellm_settings"]
    assert "postgres" in settings["success_callback"]
    assert "postgres" in settings["failure_callback"]
    assert settings["cache"] is True
    assert settings["cache_params"]["type"] == "redis"


def test_secrets_are_referenced_from_the_environment(config) -> None:
    """No literal keys in the config; everything goes through os.environ."""
    text = CONFIG_PATH.read_text(encoding="utf-8")
    assert "sk-" not in text
    assert config["general_settings"]["master_key"].startswith("os.environ/")
    for entry in config["model_list"]:
        params = entry["litellm_params"]
        assert params["model"].startswith(("openai/", "anthropic/", "gemini/", "ollama/"))
        assert any(value.startswith("os.environ/") for value in params.values())
