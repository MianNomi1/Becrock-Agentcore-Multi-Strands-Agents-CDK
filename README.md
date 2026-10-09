
# Horizon Bank Assistant: Multi-Agent System on Amazon Bedrock AgentCore

A learning project: a multi-agent banking assistant built with **Strands Agents** (Python), deployed to **Amazon Bedrock AgentCore** with **AWS CDK** (TypeScript).

> Horizon Bank is fictional. All data in this repository is dummy data.

## What it does

A customer chats from the terminal. An **orchestrator** agent routes each request to a specialist:

| Specialist | Handles | Data source |
|------------|---------|-------------|
| FAQ | App troubleshooting, products, fees, security tips | Bedrock Knowledge Base (S3 Vectors) |
| Branch | Is a branch open now, opening hours, number of representatives | DynamoDB via Lambda tools behind AgentCore Gateway (MCP) |
| Loan | Indicative loan eligibility, monthly repayment (EMI) | DynamoDB rules + Lambda maths via AgentCore Gateway (MCP) |
| Handoff | Request for a human | Flag in the response |

AgentCore services used: **Runtime** (hosting), **Gateway** (MCP tools), **Memory** (short-term conversation + long-term customer facts). A **Bedrock Guardrail** filters input and output.

## Architecture

```
scripts/chat_stream.py (your terminal, AWS credentials)
   │  InvokeAgentRuntime (IAM SigV4), streamed response
   ▼
AgentCore Runtime ── agent/ container
   ├─ Orchestrator ── Guardrail ── AgentCore Memory
   ├─ FAQ specialist ──── Retrieve ──▶ Knowledge Base ──▶ S3 Vectors
   ├─ Branch specialist ─┐
   └─ Loan specialist ───┴─ MCP (IAM) ──▶ AgentCore Gateway ──▶ Lambda ──▶ DynamoDB
```

Three CDK stacks:

| Stack | Contains |
|-------|----------|
| `BankAgents-KnowledgeBase` | Docs bucket, S3 Vectors bucket + index, Knowledge Base, data source (chunking strategy is a parameter) |
| `BankAgents-Tools` | DynamoDB tables, branch and loan Lambdas, AgentCore Gateway with two Lambda targets |
| `BankAgents-Agent` | Guardrail, AgentCore Memory, AgentCore Runtime (container built from `agent/`) |

## Repository layout

```
.
├── agent/                  # Multi-agent app deployed to AgentCore Runtime
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py             # Entrypoint + orchestrator (streams responses)
│   ├── config.py  models.py  prompts.py
│   ├── tools/              # knowledge_base.py, gateway.py, handoff.py
│   └── specialists/        # faq_agent.py, branch_agent.py, loan_agent.py
├── data/                   # Seed data: branches.json, loan_products.json
├── infra/                  # CDK app (TypeScript)
│   ├── bin/bank-agents.ts
│   ├── lib/                # config.ts, knowledge-base-stack.ts, tools-stack.ts, agent-stack.ts
│   └── cdk.json            # Context: chunking strategy and model IDs
├── knowledge-base/         # Dummy FAQ documents (.txt) ingested into the KB
├── lambdas/                # branch_tools/, loan_tools/ (Gateway tool handlers)
└── scripts/                # Helper scripts (see "Scripts" below)
```

---

## 1. Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 20 or 22 LTS | `node -v` |
| AWS CLI | v2 | `aws --version` |
| Python | 3.12+ | `python3 --version` |
| Docker Desktop | running | `docker info` |

**Apple Silicon Macs:** use a **native arm64 Python** (for example Homebrew in `/opt/homebrew`). An Intel (x86_64) Python fails to install `cryptography` because recent versions only ship arm64 wheels for macOS. Check with:

```bash
python3 -c "import platform; print(platform.machine())"   # must print arm64
```

### AWS account requirements

- **Region:** `us-east-1`.
- **Bedrock model access:** Amazon Titan Text Embeddings V2 (Knowledge Base) and the chat models you configure in `infra/cdk.json` (see step 3). If your AWS Organization uses Service Control Policies, confirm the models are allowed:

  ```bash
  aws bedrock-runtime converse --region us-east-1 --model-id us.amazon.nova-2-lite-v1:0 \
    --messages '[{"role":"user","content":[{"text":"Reply with only the word OK"}]}]' \
    --query 'output.message.content[0].text' --output text
  ```

- **Tracing** is disabled (`tracingEnabled: false` in `agent-stack.ts`). Enabling it requires **CloudWatch Transaction Search** to be active in the account first, otherwise the deployment fails on `AWS::Logs::Delivery`.

---

## 2. Configure your AWS credentials

boto3 reads the Region from `AWS_DEFAULT_REGION` or from your profile (not from `AWS_REGION`). Set both the profile and the Region:

```bash
export AWS_PROFILE=<your-profile>
export AWS_DEFAULT_REGION=us-east-1
aws configure set region us-east-1 --profile <your-profile>   # optional, makes it permanent
aws sts get-caller-identity                                    # must print your account
```

Run every command below in a terminal where these are set.

---

## 3. Install dependencies

From the repository root:

```bash
# Python virtual environment (scripts + local agent runs)
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r scripts/requirements.txt
pip install -r agent/requirements.txt

# CDK app
cd infra
npm ci
cd ..
```

### Choose models and chunking

Settings are read from the `"context"` section of `infra/cdk.json`:

```json
"context": {
  "chunking": "FIXED_SIZE",
  "orchestratorModelId": "us.amazon.nova-2-lite-v1:0",
  "specialistModelId": "us.amazon.nova-2-lite-v1:0"
}
```

| Key | Allowed values |
|-----|----------------|
| `chunking` | `FIXED_SIZE`, `SEMANTIC`, `HIERARCHICAL`, `NONE` |
| `orchestratorModelId`, `specialistModelId` | Any Bedrock inference profile ID your account can use (list them with `aws bedrock list-inference-profiles --region us-east-1`) |

Optional chunking parameters (pass with `-c key=value`): `fixedMaxTokens`, `fixedOverlapPercentage`, `semanticMaxTokens`, `semanticBufferSize`, `semanticBreakpointPercentile`, `parentMaxTokens`, `childMaxTokens`, `hierarchicalOverlapTokens`.

---

## 4. Deploy

### 4.1 Bootstrap CDK (once per account and Region)

```bash
cd infra
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/us-east-1
```

### 4.2 Deploy all stacks

Make sure Docker Desktop is running (the Agent stack builds the container image).

```bash
npx cdk deploy --all --outputs-file outputs.json
cd ..
```

This writes all stack outputs to **`infra/outputs.json`**. Every script reads its IDs and URLs from that file.

> **Always deploy with `--all --outputs-file outputs.json`.** `--outputs-file` overwrites the file with the outputs of the stacks deployed in *that* command only. Deploying a single stack would remove the other stacks' outputs and break the scripts.
>
> `infra/outputs.json` contains account-specific ARNs. It is listed in `.gitignore`; do not commit it.

### 4.3 Load the data

```bash
source .venv/bin/activate
python scripts/seed_data.py     # writes data/*.json into the DynamoDB tables
python scripts/sync_kb.py       # ingests knowledge-base/*.txt into the Knowledge Base
```

`sync_kb.py` waits for the ingestion job and should report 8 documents scanned and indexed.

### 4.4 Chat with the agent

```bash
python scripts/chat_stream.py --debug
```

---

## 5. Scripts

Run all scripts from the **repository root** with the virtual environment active.

| Script | What it does | Requires |
|--------|--------------|----------|
| `outputs.py` | Helper module that reads `infra/outputs.json`. Not run directly. | — |
| `seed_data.py` | Loads `data/branches.json` and `data/loan_products.json` into DynamoDB | Tools stack |
| `sync_kb.py` | Starts a Knowledge Base ingestion job and waits for it | KB stack |
| `compare_retrieval.py` | Runs test questions against the KB and saves the chunks to `experiments/` | KB stack + ingestion |
| `test_gateway.py` | Lists the Gateway's MCP tools and calls one, signed with your IAM credentials | Tools stack + seeded data |
| `local_env.py` | Prints `export` lines with the deployed IDs, for running the agent locally | All stacks |
| `chat_stream.py` | Interactive terminal chat with the deployed agent, streamed | All stacks |
| `test_memory_restore.py` | Checks that AgentCore Memory restores history into a new agent | Agent stack |

### `compare_retrieval.py`

```bash
python scripts/compare_retrieval.py                                     # default questions
python scripts/compare_retrieval.py --question "How do I reset my password?" --top-k 5
```

Results are saved as `experiments/retrieval-<strategy>-<fingerprint>.json`.

### `test_gateway.py`

```bash
python scripts/test_gateway.py
```

Prints the tool list (for example `branch-tools___get_branch_status`) and the result of one call.

### `chat_stream.py`

```bash
python scripts/chat_stream.py                                   # new conversation, default demo actor
python scripts/chat_stream.py --debug                           # also print tools used and stop reason
python scripts/chat_stream.py --actor-id demo-customer-002      # a different demo customer
python scripts/chat_stream.py --session-id <id-printed-on-exit> # resume a conversation
```

| Option | Meaning |
|--------|---------|
| `--session-id` | Same ID = same conversation (short-term memory). Printed when you exit. |
| `--actor-id` | Who the customer is (long-term memory is stored per actor). Demo value only, not verified identity. |
| `--debug` | Shows `tools_used` and `stop_reason` after each answer |

Example questions:

| You type | Expected behaviour |
|----------|--------------------|
| `My app is not working` | FAQ specialist returns troubleshooting steps |
| `Is the branch open?` then `Chicago` | Asks for the city, then gives live branch status |
| `How many representatives are there?` | Reuses the city from the conversation |
| `I want a personal loan, I earn 4000 a month, no debts` | Indicative eligibility with disclaimer |
| `I want to talk to a person` | Handoff flag |

### `test_memory_restore.py`

```bash
eval "$(python scripts/local_env.py)"
python scripts/test_memory_restore.py
```

Expected: `Agent 2 restored 2 messages` and the answer `Denver`.

---

## 6. Run the agent locally

Useful for fast iteration without redeploying. Uses your own AWS credentials against the deployed resources.

```bash
source .venv/bin/activate
eval "$(python scripts/local_env.py)"
export ORCHESTRATOR_MODEL_ID='us.amazon.nova-2-lite-v1:0'   # same IDs as in infra/cdk.json
export SPECIALIST_MODEL_ID='us.amazon.nova-2-lite-v1:0'
cd agent
python main.py                                              # serves on http://localhost:8080
```

In a second terminal:

```bash
SESSION=local-session-$(uuidgen)
curl -N -s -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -H "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id: $SESSION" \
  -d '{"prompt": "Is the branch open right now?", "actor_id": "demo-customer-001"}'
```

The response is a stream of `data: {...}` lines (`text` events, then one `done` event). Send more requests with the same `$SESSION` to continue the conversation.

### Test the container image before deploying

```bash
docker build -t bank-agent-test agent/
docker run --rm -p 8080:8080 -e KNOWLEDGE_BASE_ID=test -e GATEWAY_URL=https://example.com bank-agent-test
curl -s http://localhost:8080/ping       # in another terminal: expect a "Healthy" status
```

The log must show `Uvicorn running on http://0.0.0.0:8080`.

---

## 7. Common changes

| Change | Command |
|--------|---------|
| Agent code or prompts (`agent/`) | `cd infra && npx cdk deploy --all --outputs-file outputs.json` |
| Lambda tool code (`lambdas/`) | same as above |
| Seed data (`data/*.json`) | `python scripts/seed_data.py` (no deployment needed) |
| Knowledge base documents | Deploy as above, then `python scripts/sync_kb.py` |
| Chunking strategy | Set `chunking` in `infra/cdk.json` (or add `-c chunking=SEMANTIC`), deploy as above, then `python scripts/sync_kb.py` |
| Models | Set the model IDs in `infra/cdk.json`, deploy as above |

---

## 8. Logs and inspection

```bash
# Agent (Runtime) logs
LOG_GROUP=$(python -c "import sys; sys.path.insert(0,'scripts'); from outputs import get_output; print(get_output('BankAgents-Agent','RuntimeLogGroup'))")
aws logs tail "$LOG_GROUP" --follow --since 10m

# Runtime status and environment variables
RT_ID=$(python -c "import sys; sys.path.insert(0,'scripts'); from outputs import get_output; print(get_output('BankAgents-Agent','AgentRuntimeId'))")
aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$RT_ID" \
  --query '{status: status, env: environmentVariables}'

# Memory: short-term events for one session
MEM_ID=$(python -c "import sys; sys.path.insert(0,'scripts'); from outputs import get_output; print(get_output('BankAgents-Agent','MemoryId'))")
aws bedrock-agentcore list-events --memory-id "$MEM_ID" \
  --actor-id demo-customer-001 --session-id <session-id> --query 'events[].payload'

# Memory: long-term facts for one actor
aws bedrock-agentcore list-memory-records --memory-id "$MEM_ID" \
  --namespace "/bank/customers/demo-customer-001/facts" \
  --query 'memoryRecordSummaries[].content.text'
```

Useful agent log lines: `Memory restored N messages` (short-term memory loaded) and `Retrieved N memories from namespace` (long-term facts found).

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `NoRegionError: You must specify a region` | boto3 found no Region | `export AWS_DEFAULT_REGION=us-east-1` or set the Region in your profile |
| `Failed building wheel for cryptography` | x86_64 Python on Apple Silicon | Recreate `.venv` with a native arm64 Python |
| `AccessDeniedException ... explicit deny in a service control policy` | Your organisation blocks that model | Use an allowed model ID in `infra/cdk.json` |
| `X-Ray Delivery Destination is supported with CloudWatch Logs...` | Tracing enabled without Transaction Search | Keep `tracingEnabled: false`, or enable Transaction Search first |
| Runtime log: `"opentelemetry-instrument": executable file not found` | The Dockerfile `CMD` uses a package missing from `agent/requirements.txt` | Add `aws-opentelemetry-distro`, or use `CMD ["python", "main.py"]` |
| Chat hangs with no answer | Server listening on `127.0.0.1` inside the container | `ENV DOCKER_CONTAINER=1` in the Dockerfile, redeploy |
| Agent forgets earlier turns | Old image deployed / Memory not restoring | Redeploy; check for `Memory restored N messages` in the logs |
| A script says an output is not found | `infra/outputs.json` missing or overwritten | Redeploy with `--all --outputs-file outputs.json` |
| `retrieve` returns no results | Ingestion not run | `python scripts/sync_kb.py` |

---

## 10. Clean up

```bash
cd infra
npx cdk destroy --all
```

Afterwards, delete any leftover CloudWatch log groups if you want a clean account. The CDK bootstrap stack (`CDKToolkit`) can stay; it is reused by future deployments.

---

## Security notes

- Access to the agent and the Gateway is **IAM only** (SigV4). Only principals with `bedrock-agentcore:InvokeAgentRuntime` can chat.
- No secrets are stored in code or environment variables; all components use IAM roles.
- `--actor-id` is a **demo value supplied by the client**, not a verified identity. Do not use real customer data.
- Do not commit `infra/outputs.json`, `.venv/`, `infra/cdk.out/` or `experiments/`.
