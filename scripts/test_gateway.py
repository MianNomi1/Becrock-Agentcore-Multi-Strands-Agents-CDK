"""List the Gateway's MCP tools and call one, signing requests with your AWS credentials."""
import asyncio
import json
import os

from mcp import ClientSession
from mcp_proxy_for_aws.client import aws_iam_streamablehttp_client

from outputs import get_output

GATEWAY_URL = get_output("BankAgents-Tools-dummy-banking", "GatewayUrl")
REGION = os.environ.get("AWS_REGION", "us-east-1")


async def main() -> None:
    async with aws_iam_streamablehttp_client(
        endpoint=GATEWAY_URL, aws_service="bedrock-agentcore", aws_region=REGION
    ) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()

            tools = await session.list_tools()
            print("Tools published by the Gateway:")
            for t in tools.tools:
                print(f"  - {t.name}")

            result = await session.call_tool("branch-tools___get_branch_representatives", {"city": "New York"})
            print("\nResult of get_branch_representatives(New York):")
            for block in result.content:
                print(json.dumps(json.loads(block.text), indent=2) if block.type == "text" else block)


if __name__ == "__main__":
    asyncio.run(main())