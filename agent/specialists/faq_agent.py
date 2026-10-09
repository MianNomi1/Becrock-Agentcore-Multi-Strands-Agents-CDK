from strands import Agent, tool

from models import specialist_model
from prompts import FAQ_PROMPT
from tools.knowledge_base import search_knowledge_base


@tool
def faq_specialist(question: str) -> str:
    """Answer questions about the mobile app and online banking (troubleshooting, login, OTP,
    notifications), accounts and products, fees, security and fraud awareness, and support hours.

    Args:
        question: A complete, self-contained question including all relevant details.
    """
    agent = Agent(
        name="faq_specialist",
        model=specialist_model(),
        system_prompt=FAQ_PROMPT,
        tools=[search_knowledge_base],
        callback_handler=None,  # don't stream specialist tokens to stdout
    )
    return str(agent(question))