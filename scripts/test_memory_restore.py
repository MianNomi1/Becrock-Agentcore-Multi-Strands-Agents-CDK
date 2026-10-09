"""Does AgentCoreMemorySessionManager restore history into a NEW Agent?"""
import os
import uuid

from strands import Agent
from strands.models import BedrockModel
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager

MEMORY_ID = os.environ["MEMORY_ID"]
SESSION_ID = f"memory-restore-test-{uuid.uuid4()}"
ACTOR_ID = "memory-test-actor"

def new_agent() -> Agent:
    session_manager = AgentCoreMemorySessionManager(
        agentcore_memory_config=AgentCoreMemoryConfig(
            memory_id=MEMORY_ID, session_id=SESSION_ID, actor_id=ACTOR_ID
        ),
        region_name="us-east-1",
    )
    return Agent(
        model=BedrockModel(model_id="us.amazon.nova-2-lite-v1:0", region_name="us-east-1"),
        session_manager=session_manager,
        callback_handler=None,
    )

first = new_agent()
first("My favourite city is Denver. Reply with only OK.")
print("Agent 1 now holds", len(first.messages), "messages")

second = new_agent()  # simulates the next request: brand-new Agent, same session
print("Agent 2 restored", len(second.messages), "messages")
print("Agent 2 answer:", second("Which city did I say? Answer with only the city."))
