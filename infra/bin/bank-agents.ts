#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { loadConfig } from '../lib/config';
import { KnowledgeBaseStack } from '../lib/knowledge-base-stack';
import { ToolsStack } from '../lib/tools-stack';
import { AgentStack } from '../lib/agent-stack';

const app = new cdk.App();
const config = loadConfig(app);
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: config.region };

const kbStack = new KnowledgeBaseStack(app, `${config.prefix}-KnowledgeBase-dummy-banking`, { env, config });
const toolsStack = new ToolsStack(app, `${config.prefix}-Tools-dummy-banking`, { env, config });

new AgentStack(app, `${config.prefix}-Agent-dummy-banking`, {
    env,
    config,
    knowledgeBaseId: kbStack.knowledgeBaseId,
    knowledgeBaseArn: kbStack.knowledgeBaseArn,
    gateway: toolsStack.gateway,
});

cdk.Tags.of(app).add('project', 'horizonbank-agents');
cdk.Tags.of(app).add('environment', 'handson bedrock Agents core');




