"""AgentCore Runtime entrypoint: builds the orchestrator and handles each invocation."""
import logging
import re

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent

import config
from models import orchestrator_model
from prompts import ORCHESTRATOR_PROMPT
from specialists.branch_agent import branch_specialist
from specialists.faq_agent import faq_specialist
from specialists.loan_agent import loan_specialist
from tools.handoff import request_human_agent

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("orchestrator")

app = BedrockAgentCoreApp()

ACTOR_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_PROMPT_LENGTH = 2000
TOOLS = [faq_specialist, branch_specialist, loan_specialist, request_human_agent]

# Used only when MEMORY_ID is not set.
_local_agents: dict[str, Agent] = {}

# Our session manager
def _session_manager(session_id: str, actor_id: str):
    """AgentCore Memory: restores short-term history and retrieves long-term customer facts."""
    from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig, RetrievalConfig
    from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
    
    memory_config = AgentCoreMemoryConfig(
        memory_id=config.MEMORY_ID,
        session_id=session_id,
        actor_id=actor_id,
        retrieval_config={
            config.CUSTOMER_FACTS_NAMESPACE: RetrievalConfig(top_k=5, relevance_score=0.4),
        },
    )
    return AgentCoreMemorySessionManager(agentcore_memory_config=memory_config, region_name=config.REGION)
    
def build_orchestrator(session_id: str, actor_id: str) -> Agent:
    if config.MEMORY_ID:
        agent = Agent(
            name="orchestrator",
            model=orchestrator_model(),
            system_prompt=ORCHESTRATOR_PROMPT,
            tools=TOOLS,
            session_manager=_session_manager(session_id, actor_id),
            callback_handler=None
        )
        logger.info("Memory restored %d messages for session=%s", len(agent.messages), session_id)
        return agent
    # Local fallback: keep the agent in process memory so multi-turn chat still works.
    if session_id not in _local_agents:
        _local_agents[session_id] = Agent(
            name="orchestrator",
            model=orchestrator_model(),
            system_prompt=ORCHESTRATOR_PROMPT,
            tools=TOOLS,
            callback_handler=None,
        )
    return _local_agents[session_id]
    
@app.entrypoint
async def invoke(payload: dict, context) -> dict:
        payload = payload or {}
        prompt = str(payload.get("prompt", "")).strip()
        if not prompt:
            yield {"error": "Payload must include a non-empty 'prompt'."}
            return
        if len(prompt) > MAX_PROMPT_LENGTH:
            yield {"error": f"Prompt is too long (max {MAX_PROMPT_LENGTH} characters)."}
            return

        actor_id = str(payload.get("actor_id", "anonymous"))
        if not ACTOR_ID_PATTERN.match(actor_id):
            yield {"error": "actor_id may only contain letters, numbers, '_' and '-' (max 64)."}
            return

        session_id = getattr(context, "session_id", None) or "local-dev-session-00000000000000000"
        logger.info("Invocation session=%s actor=%s", session_id, actor_id)
        
        agent = build_orchestrator(session_id, actor_id)
        
        if config.STREAMING:
            async for event in agent.stream_async(prompt):
                if "data" in event:
                    yield { "type": "text", "data": event["data"] }
                elif "result" in event:
                    result = event["result"]
                    tools_used = sorted(result.metrics.tool_metrics.keys())
                    yield {
                        "type": "done",
                        "tools_used": tools_used,
                        "handoff_requested": "request_human_agent" in tools_used,
                        "stop_reason": str(result.stop_reason),
                    }
        else:    
            result = agent(prompt)
            tools_used = sorted(result.metrics.tool_metrics.keys())
            yield {
                "response": str(result).strip(),
                "tools_used": tools_used,
                "handoff_requested": "request_human_agent" in tools_used,
                "stop_reason": str(result.stop_reason),  # "guardrail_intervened" when blocked
                "session_id": session_id,
            }
            return
        
        
if __name__ == "__main__":
    app.run() #This will be invoked on POST /invocations and GET /ping on port 8080