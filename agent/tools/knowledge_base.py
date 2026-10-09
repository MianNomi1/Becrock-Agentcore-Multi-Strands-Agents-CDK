"""RAG tool: query the Bedrock Knowledge Base."""
import logging

import boto3
from strands import tool

import config

logger = logging.getLogger(__name__)
_client = boto3.client("bedrock-agent-runtime", region_name=config.REGION)

MAX_QUERY_LENGTH = 1000

 
@tool
def search_knowledge_base(query: str) -> str:
    """Search Horizon Bank's FAQ, product, fee, security and policy documents.

    Args:
        query: A short, specific search query, for example "app will not open steps".
    """
    query = (query or "").strip()[:MAX_QUERY_LENGTH]
    if not query:
        return "The query was empty."

    response = _client.retrieve(
        knowledgeBaseId=config.KNOWLEDGE_BASE_ID,
        retrievalQuery={"text": query},
        retrievalConfiguration={"vectorSearchConfiguration": {"numberOfResults": 5}},
    )
    results = response.get("retrievalResults", [])
    logger.info("KB query returned %d results", len(results))
    if not results:
        return "No relevant documents found."

    passages = []
    for rank, item in enumerate(results, start=1):
        source = item.get("location", {}).get("s3Location", {}).get("uri", "unknown").split("/")[-1]
        passages.append(f"[{rank}] (source: {source}, score: {item.get('score', 0):.2f})\n{item['content']['text']}")
    return "\n\n".join(passages)