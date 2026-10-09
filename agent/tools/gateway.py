"""MCP client for AgentCore Gateway, authenticated with the Runtime's IAM role (SigV4)."""
from mcp_proxy_for_aws.client import aws_iam_streamablehttp_client
from strands.tools.mcp import MCPClient

import config


def gateway_client() -> MCPClient:
    """Create a new MCP client. Use it inside a `with` block."""
    return MCPClient(
        lambda: aws_iam_streamablehttp_client(
            endpoint=config.GATEWAY_URL,
            aws_service="bedrock-agentcore",  # SigV4 signing service name for AgentCore
            aws_region=config.REGION,
        )
    )


def tools_for_target(client: MCPClient, target_name: str) -> list:
    """Return only the tools that belong to one Gateway target (least privilege per agent)."""
    prefix = f"{target_name}___"
    return [t for t in client.list_tools_sync() if t.tool_name.startswith(prefix)]