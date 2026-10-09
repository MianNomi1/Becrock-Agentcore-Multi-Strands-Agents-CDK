import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as s3vectors from 'aws-cdk-lib/aws-s3vectors';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ChunkingStrategy, ChunkingParams, ProjectConfig } from './config';

export interface KnowledgeBaseStackProps extends cdk.StackProps {
    config: ProjectConfig
}

function buildChunkingConfiguration(
    strategy: ChunkingStrategy,
    p: ChunkingParams
): bedrock.CfnDataSource.ChunkingConfigurationProperty {
    switch (strategy) {
        case "FIXED_SIZE":
            return {
                chunkingStrategy: 'FIXED_SIZE',
                fixedSizeChunkingConfiguration: {
                    maxTokens: p.fixedMaxTokens,
                    overlapPercentage: p.fixedOverlapPercentage
                }
            };
        case 'SEMANTIC':
            return {
                chunkingStrategy: 'SEMANTIC',
                semanticChunkingConfiguration: {
                    maxTokens: p.semanticMaxTokens,
                    bufferSize: p.semanticBufferSize,
                    breakpointPercentileThreshold: p.semanticBreakpointPercentile,
                },
            };
        case 'HIERARCHICAL':
            return {
                chunkingStrategy: 'HIERARCHICAL',
                hierarchicalChunkingConfiguration: {
                    // Order matters: first = parent, second = child.
                    levelConfigurations: [{ maxTokens: p.parentMaxTokens }, { maxTokens: p.childMaxTokens }],
                    overlapTokens: p.hierarchicalOverlapTokens,
                }
            }
        case 'NONE':
            return { chunkingStrategy: 'NONE' }
    }
}

export class KnowledgeBaseStack extends cdk.Stack {
    public readonly knowledgeBaseId: string;
    public readonly knowledgeBaseArn: string;

    constructor(scope: Construct, id: string, props: KnowledgeBaseStackProps) {
        super(scope, id, props);
        const { config } = props;

        // ---------- 1. Source documents bucket ----------
        const docsBucket = new s3.Bucket(this, 'DocsBucket-dummy-banking', {
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // learning project: clean teardown
            autoDeleteObjects: true,
        });

        new s3deploy.BucketDeployment(this, 'DeployDocs-dummy-banking', {
            sources: [s3deploy.Source.asset(path.join(__dirname, '../../knowledge-base'))],
            destinationBucket: docsBucket,
            destinationKeyPrefix: 'docs/',
        });

        // ---------- 2. S3 Vectors: bucket + index ----------
        const vectorBucket = new s3vectors.CfnVectorBucket(this, 'VectorBucket-dummy-banking', {});

        const vectorIndex = new s3vectors.CfnIndex(this, 'VectorIndex', {
            vectorBucketArn: vectorBucket.attrVectorBucketArn,
            dataType: 'float32',
            dimension: config.embeddingDimensions, // must match the embedding model output
            distanceMetric: 'cosine',
            metadataConfiguration: {
                // Bedrock stores chunk text and its own metadata here. They are large, so they
                // must be NON-filterable (filterable metadata has a much smaller size limit).
                nonFilterableMetadataKeys: ['AMAZON_BEDROCK_TEXT', 'AMAZON_BEDROCK_METADATA'],
            },
        });

        // ---------- 3. IAM role the Knowledge Base assumes ----------
        const embeddingModelArn = `arn:aws:bedrock:${this.region}::foundation-model/${config.embeddingModelId}`;

        const kbRole = new iam.Role(this, 'KnowledgeBaseRole-dummy-banking', {
            description: 'Assumed by Amazon Bedrock Knowledge Bases to read docs and write vectors',
            assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com', {
                // Confused-deputy protection: only KBs in THIS account can use the role.
                conditions: {
                    StringEquals: { 'aws:SourceAccount': this.account },
                    ArnLike: { 'aws:SourceArn': `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*` },
                },
            }),
            inlinePolicies: {
                KnowledgeBaseAccess: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            sid: 'EmbedChunks',
                            actions: ['bedrock:InvokeModel'],
                            resources: [embeddingModelArn],
                        }),
                        new iam.PolicyStatement({
                            sid: 'ListDocs',
                            actions: ['s3:ListBucket'],
                            resources: [docsBucket.bucketArn],
                        }),
                        new iam.PolicyStatement({
                            sid: 'ReadDocs',
                            actions: ['s3:GetObject'],
                            resources: [docsBucket.arnForObjects('docs/*')],
                        }),
                        new iam.PolicyStatement({
                            sid: 'ReadWriteVectors',
                            actions: [
                                's3vectors:PutVectors',
                                's3vectors:GetVectors',
                                's3vectors:DeleteVectors',
                                's3vectors:QueryVectors',
                                's3vectors:GetIndex',
                            ],
                            resources: [vectorIndex.attrIndexArn],
                        }),
                    ],
                }),
            },
        });

        // ---------- 4. The Knowledge Base ----------
        const knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'KnowledgeBase-dummy-banking', {
            name: 'horizon-bank-faq-kb',
            description: 'Horizon Bank FAQ, product and policy documents',
            roleArn: kbRole.roleArn,
            knowledgeBaseConfiguration: {
                type: 'VECTOR',
                vectorKnowledgeBaseConfiguration: {
                    embeddingModelArn,
                    embeddingModelConfiguration: {
                        bedrockEmbeddingModelConfiguration: {
                            dimensions: config.embeddingDimensions,
                            embeddingDataType: 'FLOAT32',
                        },
                    },
                },
            },
            storageConfiguration: {
                type: 'S3_VECTORS',
                s3VectorsConfiguration: {
                    indexArn: vectorIndex.attrIndexArn,
                },
            },
        });

        // ---------- 5. Data source with the chosen chunking strategy ----------
        const chunkingConfiguration = buildChunkingConfiguration(config.chunking, config.chunkingParams);

        // Fingerprint the config so any change creates a NEW data source.
        const fingerprint = crypto
            .createHash('sha256')
            .update(JSON.stringify(chunkingConfiguration))
            .digest('hex')
            .slice(0, 8);
        const strategySlug = config.chunking.toLowerCase().replace('_', '-');

        const dataSource = new bedrock.CfnDataSource(this, `DataSource${fingerprint}`, {
            knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
            name: `horizon-docs-${strategySlug}-${fingerprint}`,
            description: `Chunking: ${config.chunking}`,
            dataDeletionPolicy: 'DELETE', // remove vectors when the data source is deleted
            dataSourceConfiguration: {
                type: 'S3',
                s3Configuration: {
                    bucketArn: docsBucket.bucketArn,
                    inclusionPrefixes: ['docs/'],
                },
            },
            vectorIngestionConfiguration: {
                chunkingConfiguration,
            },
        });

        this.knowledgeBaseId = knowledgeBase.attrKnowledgeBaseId;
        this.knowledgeBaseArn = knowledgeBase.attrKnowledgeBaseArn;

        // ---------- 6. Outputs (written to infra/outputs.json) ----------
        new cdk.CfnOutput(this, 'KnowledgeBaseId', { value: this.knowledgeBaseId });
        new cdk.CfnOutput(this, 'DataSourceId', { value: dataSource.attrDataSourceId });
        new cdk.CfnOutput(this, 'ChunkingStrategy', { value: config.chunking });
        new cdk.CfnOutput(this, 'ChunkingFingerprint', { value: fingerprint });
        new cdk.CfnOutput(this, 'DocsBucketName', { value: docsBucket.bucketName });
    }
}