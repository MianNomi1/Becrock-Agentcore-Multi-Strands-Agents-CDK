import { App } from 'aws-cdk-lib';

// All possible chunking strategies
export type ChunkingStrategy = 'FIXED_SIZE' | 'SEMANTIC' | 'HIERARCHICAL' | 'NONE';

// Let's check what are the valid ones
const VALID_STRATEGIES: ChunkingStrategy[] = ['FIXED_SIZE', 'SEMANTIC', 'HIERARCHICAL', 'NONE'];

export interface ChunkingParams {
    /** FIXED_SIZE: max tokens per chunk. */
    fixedMaxTokens: number;
    /** FIXED_SIZE: overlap between consecutive chunks, in percent (1-99). */
    fixedOverlapPercentage: number;
    /** SEMANTIC: max tokens per chunk. */
    semanticMaxTokens: number;
    /** SEMANTIC: how many surrounding sentences are compared when looking for a topic shift (0-1). */
    semanticBufferSize: number;
    /** SEMANTIC: higher = fewer, larger chunks (50-99). */
    semanticBreakpointPercentile: number;
    /** HIERARCHICAL: parent chunk size. Keep modest with S3 Vectors (metadata limits). */
    parentMaxTokens: number;
    /** HIERARCHICAL: child chunk size (what is actually matched). */
    childMaxTokens: number;
    /** HIERARCHICAL: overlap between child chunks, in tokens. */
    hierarchicalOverlapTokens: number;
}

export interface ProjectConfig {
    prefix: string;
    region: string;
    chunking: ChunkingStrategy;
    chunkingParams: ChunkingParams;
    embeddingModelId: string;
    embeddingDimensions: number;
    orchestratorModelId: string; // This is going to do the heavy stuff for example 
    // asking follow up questions and composing the answers

    specialistModelId: string; // This is the specialist of normal stuff for example
    // What tool to call? fast simple response back without much of the thinking
}

function num(app: App, key: string, fallback: number): number {
    const raw = app.node.tryGetContext(key);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (Number.isNaN(value)) {
        throw new Error(`Context value "${key}" must be a number, got "${raw}"`);
    }
    return value;
}

export function loadConfig(app: App): ProjectConfig {
    const chunking = String(app.node.tryGetContext('chunking') ?? 'FIXED_SIZE').toUpperCase() as ChunkingStrategy;
    // If that is not a valid chuncking
    // Do not Accpet that strategy
    if (!VALID_STRATEGIES.includes(chunking)) {
        throw new Error(`Invalid chunking "${chunking}". Use one of: ${VALID_STRATEGIES.join(', ')}`);
    }

    return {
        prefix: 'BankAgents',
        region: 'us-east-1',
        chunking,
        chunkingParams: {
            fixedMaxTokens: num(app, 'fixedMaxTokens', 300),
            fixedOverlapPercentage: num(app, 'fixedOverlapPercentage', 20),
            semanticMaxTokens: num(app, 'semanticMaxTokens', 300),
            semanticBufferSize: num(app, 'semanticBufferSize', 1),
            semanticBreakpointPercentile: num(app, 'semanticBreakpointPercentile', 95),
            parentMaxTokens: num(app, 'parentMaxTokens', 1000),
            childMaxTokens: num(app, 'childMaxTokens', 200),
            hierarchicalOverlapTokens: num(app, 'hierarchicalOverlapTokens', 40),
        },
        embeddingModelId: 'amazon.titan-embed-text-v2:0',
        embeddingDimensions: 1024, // Keeping it high intentionally for now
        orchestratorModelId: app.node.tryGetContext('orchestratorModelId') ?? 'us.amazon.nova-2-lite-v1:0',
        specialistModelId: app.node.tryGetContext('specialistModelId') ?? 'us.amazon.nova-2-lite-v1:0',
    };
}