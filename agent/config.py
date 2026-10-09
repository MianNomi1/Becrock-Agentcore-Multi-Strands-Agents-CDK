"""Runtime configuration, read from environment variables set by CDK."""
import os


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Environment variable {name} is required")
    return value


REGION = os.environ.get("AWS_REGION", "us-east-1")

KNOWLEDGE_BASE_ID = _required("KNOWLEDGE_BASE_ID")
GATEWAY_URL = _required("GATEWAY_URL")

ORCHESTRATOR_MODEL_ID = os.environ.get("ORCHESTRATOR_MODEL_ID", "us.amazon.nova-2-lite-v1:0")
SPECIALIST_MODEL_ID = os.environ.get("SPECIALIST_MODEL_ID", "us.amazon.nova-2-lite-v1:0")

# Optional so you can run locally
MEMORY_ID = os.environ.get("MEMORY_ID", "").strip() or None
GUARDRAIL_ID = os.environ.get("GUARDRAIL_ID", "").strip() or None
GUARDRAIL_VERSION = os.environ.get("GUARDRAIL_VERSION", "").strip() or None

# Long-term memory namespace; must match the namespace in agent-stack.ts.
CUSTOMER_FACTS_NAMESPACE = "/bank/customers/{actorId}/facts"

#Make the response streaming
STREAMING = True