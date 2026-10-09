# AgentCore Runtime runs ARM64 (Graviton) containers.
FROM --platform=linux/arm64 public.ecr.aws/docker/library/python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DOCKER_CONTAINER=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Don't run as root.
RUN useradd --create-home --uid 1000 agent
USER agent

EXPOSE 8080

# opentelemetry-instrument (from aws-opentelemetry-distro) auto-instruments the app so
# traces flow to AgentCore Observability.
CMD ["python", "main.py"]