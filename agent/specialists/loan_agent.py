from strands import Agent, tool
from models import specialist_model
from prompts import LOAN_PROMPT

from tools.gateway import gateway_client, tools_for_target
from tools.knowledge_base import search_knowledge_base

@tool
def loan_specialist(question: str) -> str:
    """Answer loan questions: indicative eligibility based on salary and existing debt, loan products
    and rates, monthly repayment (EMI) estimates, required documents and how to apply.

    Args:
        question: A complete, self-contained question with loan type, salary (or salary range),
            existing monthly debt, amount and term when known.
    """
    client = gateway_client()
    with client:
        agent = Agent(
            name="loan_specialist",
            model=specialist_model(),
            system_prompt=LOAN_PROMPT,
            tools=[*tools_for_target(client, "loan-tools"), search_knowledge_base]
        )
        return str(agent(question))

