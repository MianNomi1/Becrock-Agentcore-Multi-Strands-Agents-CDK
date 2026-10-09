"""Print `export` lines so the local agent uses the deployed resources.

Usage: eval "$(python scripts/local_env.py)"
"""
import json

from outputs import OUTPUTS_FILE

KEYS = {
    ("BankAgents-KnowledgeBase-dummy-banking", "KnowledgeBaseId"): "KNOWLEDGE_BASE_ID",
    ("BankAgents-Tools-dummy-banking", "GatewayUrl"): "GATEWAY_URL",
    ("BankAgents-Agent-dummy-banking", "MemoryId"): "MEMORY_ID",
    ("BankAgents-Agent-dummy-banking", "GuardrailId"): "GUARDRAIL_ID",
    ("BankAgents-Agent-dummy-banking", "GuardrailVersion"): "GUARDRAIL_VERSION",
}

outputs = json.loads(OUTPUTS_FILE.read_text())
for (stack, key), env_name in KEYS.items():
    value = outputs.get(stack, {}).get(key)
    if value:
        print(f"export {env_name}='{value}'")