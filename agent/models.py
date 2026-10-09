"""Model factories. One place to change model IDs, temperature and guardrails."""
from strands.models import BedrockModel

import config


def orchestrator_model() -> BedrockModel:
    kwargs = {}
    if config.GUARDRAIL_ID and config.GUARDRAIL_VERSION:
        kwargs.update(
            guardrail_id=config.GUARDRAIL_ID,
            guardrail_version=config.GUARDRAIL_VERSION,
            guardrail_trace="enabled",  # guardrail decisions appear in traces
        )
    return BedrockModel(
        model_id=config.ORCHESTRATOR_MODEL_ID,
        region_name=config.REGION,
        temperature=0.2,  # low: we want consistent routing, not creativity
        max_tokens=1500,
        **kwargs,
    )


def specialist_model() -> BedrockModel:
    return BedrockModel(
        model_id=config.SPECIALIST_MODEL_ID,
        region_name=config.REGION,
        temperature=0.0,
        max_tokens=1500,
    )