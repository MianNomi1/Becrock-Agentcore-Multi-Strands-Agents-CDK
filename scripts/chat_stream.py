"""Interactive terminal chat with the Horizon Bank assistant on AgentCore Runtime.

Usage:
    python scripts/chat.py
    python scripts/chat.py --actor-id demo-customer-002
    python scripts/chat.py --session-id <existing id>   # resume a conversation
"""
import argparse
import json
import uuid

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from outputs import get_output

CYAN, GREY, YELLOW, RESET = "\033[36m", "\033[90m", "\033[33m", "\033[0m"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--actor-id", default="demo-customer-001", help="Demo customer ID (not real identity)")
    parser.add_argument("--session-id", help="Resume an existing session")
    parser.add_argument("--debug", action="store_true", help="Show tools used and stop reason")
    args = parser.parse_args()

    runtime_arn = get_output("BankAgents-Agent-dummy-banking", "AgentRuntimeArn")
    session_id = args.session_id or f"terminal-chat-{uuid.uuid4()}"  # >= 33 characters

    client = boto3.client("bedrock-agentcore", config=Config(read_timeout=300, retries={"max_attempts": 2}))

    print(f"{GREY}Session: {session_id}\nActor:   {args.actor_id}\nType 'exit' to quit.{RESET}\n")
    while True:
        try:
            prompt = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if prompt.lower() in {"exit", "quit"}:
            break
        if not prompt:
            continue

        try:
            response = client.invoke_agent_runtime(
                agentRuntimeArn=runtime_arn,
                runtimeSessionId=session_id,
                qualifier="DEFAULT",
                contentType="application/json",
                accept="application/json",
                payload=json.dumps({"prompt": prompt, "actor_id": args.actor_id}).encode("utf-8"),
            )
        except ClientError as err:
            print(f"{YELLOW}AWS error: {err.response['Error']['Code']}: {err.response['Error']['Message']}{RESET}")
            continue

        print(f"{CYAN}Assistant:{RESET} ", end="", flush=True)
        done = {}
        for line in response["response"].iter_lines(chunk_size=10):
            line = line.decode("utf-8").strip()
            if not line.startswith("data:"):
                continue
            event = json.loads(line[len("data:"):].strip())
            if event.get("type") == "text":
                print(event["data"], end="", flush=True)   # print each piece immediately
            elif event.get("type") == "error":
                print(f"{YELLOW}Agent error: {event['error']}{RESET}", end="")
            elif event.get("type") == "done":
                done = event
        print()

        if done.get("handoff_requested"):
            print(f"{YELLOW}[handoff requested → in Phase 2, Amazon Connect transfers to a human]{RESET}")
        if args.debug and done:
            print(f"{GREY}  tools_used={done.get('tools_used')} stop_reason={done.get('stop_reason')}{RESET}")
        print()


    print(f"{GREY}Resume later with: python scripts/chat_stream.py --session-id {session_id}{RESET}")


if __name__ == "__main__":
    main()