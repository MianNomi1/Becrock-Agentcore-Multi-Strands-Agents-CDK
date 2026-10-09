from strands import Agent, tool

from models import specialist_model
from prompts import BRANCH_PROMPT
from tools.gateway import gateway_client, tools_for_target


@tool
def branch_specialist(question: str) -> str:
    """Answer questions about Horizon Bank branches: whether a branch in a city is open now,
    opening hours, how many representatives work there, services, and which cities have branches.

    Args:
        question: A complete, self-contained question that includes the city when known.
    """
    client = gateway_client()
    with client:  # opens the MCP session; closed automatically afterwards
        agent = Agent(
            name="branch_specialist",
            model=specialist_model(),
            system_prompt=BRANCH_PROMPT,
            tools=tools_for_target(client, "branch-tools"),
            callback_handler=None,
        )
        return str(agent(question))