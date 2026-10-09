"""Query the Knowledge Base with fixed test questions and save the results.

Run after each chunking change to compare strategies side by side:
    python scripts/compare_retrieval.py
    python scripts/compare_retrieval.py --question "How do I reset my password?"
"""
import argparse
import json
from pathlib import Path

import boto3

from outputs import get_output

STACK = "BankAgents-KnowledgeBase-dummy-banking"

DEFAULT_QUESTIONS = [
    "The app is not working, what should I do?",
    "I am not receiving my OTP code",
    "How much does an international wire transfer cost?",
    "How is loan eligibility calculated?",
    "What will the bank never ask me for?",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--question", action="append", help="Question to test (repeatable)")
    parser.add_argument("--top-k", type=int, default=3)
    args = parser.parse_args()

    kb_id = get_output(STACK, "KnowledgeBaseId")
    strategy = get_output(STACK, "ChunkingStrategy")
    fingerprint = get_output(STACK, "ChunkingFingerprint")
    questions = args.question or DEFAULT_QUESTIONS

    client = boto3.client("bedrock-agent-runtime")
    report = {"strategy": strategy, "fingerprint": fingerprint, "results": []}

    for question in questions:
        response = client.retrieve(
            knowledgeBaseId=kb_id,
            retrievalQuery={"text": question},
            retrievalConfiguration={"vectorSearchConfiguration": {"numberOfResults": args.top_k}},
        )
        print("=" * 100)
        print(f"Q: {question}   [{strategy}]")
        chunks = []
        for rank, item in enumerate(response["retrievalResults"], start=1):
            text = item["content"]["text"]
            source = item["location"]["s3Location"]["uri"].split("/")[-1]
            score = item.get("score", 0.0)
            print(f"\n  #{rank} score={score:.3f} source={source} chars={len(text)}")
            print("  " + text[:400].replace("\n", " ") + ("..." if len(text) > 400 else ""))
            chunks.append({"rank": rank, "score": score, "source": source, "chars": len(text), "text": text})
        report["results"].append({"question": question, "chunks": chunks})

    out_dir = Path("experiments")
    out_dir.mkdir(exist_ok=True)
    out_file = out_dir / f"retrieval-{strategy.lower()}-{fingerprint}.json"
    out_file.write_text(json.dumps(report, indent=2))
    print(f"\nSaved {out_file}")


if __name__ == "__main__":
    main()