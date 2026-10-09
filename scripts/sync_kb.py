# Starting the ingestion job from here
import time
import boto3
from outputs import get_output

STACK = "BankAgents-KnowledgeBase-dummy-banking"

def main() -> None:
    kb_id = get_output(STACK, "KnowledgeBaseId")
    ds_id = get_output(STACK, "DataSourceId")
    strategy = get_output(STACK, "ChunkingStrategy")

    client = boto3.client("bedrock-agent")

    job = client.start_ingestion_job(knowledgeBaseId=kb_id, dataSourceId=ds_id)["ingestionJob"]
    job_id = job["ingestionJobId"]

    print(f"Started Ingestion Job {job_id}")

    while True:
        job = client.get_ingestion_job(
            knowledgeBaseId=kb_id, dataSourceId=ds_id, ingestionJobId=job_id
        )["ingestionJob"]
        status = job["status"]
        print(f"status: {status}")

        if status in ("COMPLETE", "FAILED", "STOPPED"):
            break
        time.sleep(10)

    stats = job.get("statistics", {})
    print("\nIngestion statistics:")
    for key in (
        "numberOfDocumentsScanned",
        "numberOfNewDocumentsIndexed",
        "numberOfModifiedDocumentsIndexed",
        "numberOfDocumentsDeleted",
        "numberOfDocumentsFailed",
    ):
        print(f"  {key}: {stats.get(key, 0)}")

    if status != "COMPLETE":
        for reason in job.get("failureReasons", []):
            print(f"  failure: {reason}")
        raise SystemExit(1)
        
if __name__ == "__main__":
    main()