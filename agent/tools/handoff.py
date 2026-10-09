"""Human handoff tool. In Phase 2, Amazon Connect will turn this signal into a real transfer."""
import json
import logging

from strands import tool

logger = logging.getLogger(__name__)


@tool
def request_human_agent(reason: str) -> str:
    """Transfer the customer to a human representative.

    Use when the customer asks for a person, wants to complain, reports fraud or a lost or stolen
    card, needs personal account details, or is still stuck after troubleshooting.

    Args:
        reason: One sentence describing why the customer needs a human.
    """
    logger.info("HANDOFF_REQUESTED reason=%s", reason)
    return json.dumps({
        "handoff": True,
        "queue": "general_support",
        "reason": reason,
        "instruction_for_assistant": "Tell the customer you are connecting them to a representative "
        "and give the support hours from the knowledge base if relevant.",
    })