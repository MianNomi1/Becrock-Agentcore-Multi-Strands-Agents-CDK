import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import { ProjectConfig } from './config';

export interface AgentStackProps extends cdk.StackProps {
    config: ProjectConfig;
    knowledgeBaseId: string;
    knowledgeBaseArn: string;
    gateway: agentcore.Gateway;
}

/** "us.anthropic.claude-x" -> "anthropic.claude-x" (the underlying foundation model ID). */
function foundationModelId(inferenceProfileId: string): string {
    return inferenceProfileId.replace(/^(us|eu|apac|global)\./, '');
}

export class AgentStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: AgentStackProps) {
        super(scope, id, props);
        const { config } = props;

        // ---------- 1. Guardrail ----------
        const guardrail = new bedrock.CfnGuardrail(this, 'BankGuardrail', {
            name: 'horizon-bank-assistant-guardrail',
            description: 'Safety, PII and topic controls for the Horizon Bank assistant',
            blockedInputMessaging:
                'Sorry, I can\'t help with that. For your security, please never share card numbers, PINs, passwords or one-time passcodes.',
            blockedOutputsMessaging: 'Sorry, I can\'t provide that information. Is there anything else I can help with?',
            contentPolicyConfig: {
                filtersConfig: [
                    { type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' },
                    { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
                    { type: 'INSULTS', inputStrength: 'MEDIUM', outputStrength: 'HIGH' },
                    { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
                    { type: 'VIOLENCE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
                    { type: 'MISCONDUCT', inputStrength: 'HIGH', outputStrength: 'HIGH' },
                ],
            },
            topicPolicyConfig: {
                topicsConfig: [
                    {
                        name: 'Investment advice',
                        type: 'DENY',
                        definition:
                            'Personalised recommendations to buy, sell or hold specific stocks, bonds, funds, cryptocurrencies or other investments.',
                        examples: [
                            'Which stocks should I buy this month?',
                            'Should I move my savings into bitcoin?',
                            'Is it a good time to invest in tech funds?',
                        ],
                    },
                ],
            },
            sensitiveInformationPolicyConfig: {
                piiEntitiesConfig: [
                    { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' },
                    { type: 'CREDIT_DEBIT_CARD_CVV', action: 'BLOCK' },
                    { type: 'PIN', action: 'BLOCK' },
                    { type: 'PASSWORD', action: 'BLOCK' },
                    { type: 'US_SOCIAL_SECURITY_NUMBER', action: 'BLOCK' },
                    { type: 'US_BANK_ACCOUNT_NUMBER', action: 'BLOCK' },
                    { type: 'EMAIL', action: 'ANONYMIZE' },
                ],
            },
        });

        // Immutable snapshot. To publish a change: edit the guardrail above AND rename
        // this construct ID (V1 -> V2) so CloudFormation creates a new version.
        const guardrailVersion = new bedrock.CfnGuardrailVersion(this, 'BankGuardrailV1', {
            guardrailIdentifier: guardrail.attrGuardrailId,
            description: 'v1 - initial policies',
        });

        // ---------- 2. Memory ----------
        const memory = new agentcore.Memory(this, 'AssistantMemory', {
            memoryName: 'horizon_bank_assistant_memory',
            description: 'Conversation history and customer facts for the Horizon Bank assistant',
            expirationDuration: cdk.Duration.days(7), // keep raw events briefly (data minimisation)
            memoryStrategies: [
                agentcore.MemoryStrategy.usingSemantic({
                    strategyName: 'CustomerFacts',
                    namespaces: ['/bank/customers/{actorId}/facts'], // must match agent/config.py
                }),
            ],
        });

        // ---------- 3. Runtime ----------
        const runtime = new agentcore.Runtime(this, 'AssistantRuntime', {
            runtimeName: 'horizon_bank_assistant',
            description: 'Horizon Bank multi-agent assistant (orchestrator + specialists)',
            agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromAsset(path.join(__dirname, '../../agent')),
            environmentVariables: {
                KNOWLEDGE_BASE_ID: props.knowledgeBaseId,
                GATEWAY_URL: props.gateway.gatewayUrl!,
                MEMORY_ID: memory.memoryId,
                GUARDRAIL_ID: guardrail.attrGuardrailId,
                GUARDRAIL_VERSION: guardrailVersion.attrVersion,
                ORCHESTRATOR_MODEL_ID: config.orchestratorModelId,
                SPECIALIST_MODEL_ID: config.specialistModelId,
            },
            tracingEnabled: false, // Keeping it fals intentional, for transactional logging the acount level configuration
            // needs to be changed. They need to have X-ray enabled.

            // No authorizerConfiguration: the default is IAM (SigV4) inbound auth.
        });

        // ---------- 4. Least-privilege permissions for the execution role ----------
        const modelIds = [config.orchestratorModelId, config.specialistModelId];
        runtime.addToRolePolicy(
            new iam.PolicyStatement({
                sid: 'InvokeModelsViaInferenceProfiles',
                actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
                resources: [
                    ...modelIds.map((m) => `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${m}`),
                    // Cross-Region profiles route to any US Region, so allow the model in all Regions.
                    ...modelIds.map((m) => `arn:aws:bedrock:*::foundation-model/${foundationModelId(m)}`),
                ],
            }),
        );
        runtime.addToRolePolicy(
            new iam.PolicyStatement({
                sid: 'RetrieveFromKnowledgeBase',
                actions: ['bedrock:Retrieve'],
                resources: [props.knowledgeBaseArn],
            }),
        );
        runtime.addToRolePolicy(
            new iam.PolicyStatement({
                sid: 'ApplyGuardrail',
                actions: ['bedrock:ApplyGuardrail'],
                resources: [guardrail.attrGuardrailArn],
            }),
        );
        memory.grantRead(runtime);
        memory.grantWrite(runtime);
        props.gateway.grantInvoke(runtime); // bedrock-agentcore:InvokeGateway on this Gateway only

        // ---------- 5. Outputs ----------
        new cdk.CfnOutput(this, 'AgentRuntimeArn', { value: runtime.agentRuntimeArn });
        new cdk.CfnOutput(this, 'AgentRuntimeId', { value: runtime.agentRuntimeId });
        new cdk.CfnOutput(this, 'RuntimeLogGroup', { value: runtime.applicationLogGroup.logGroupName });
        new cdk.CfnOutput(this, 'MemoryId', { value: memory.memoryId });
        new cdk.CfnOutput(this, 'GuardrailId', { value: guardrail.attrGuardrailId });
        new cdk.CfnOutput(this, 'GuardrailVersion', { value: guardrailVersion.attrVersion });
    }
}