import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import { ProjectConfig } from './config';

export interface ToolsStackProps extends cdk.StackProps {
    config: ProjectConfig;
}

const S = agentcore.SchemaDefinitionType; // shorthand for schema types

export class ToolsStack extends cdk.Stack {
    public readonly gateway: agentcore.Gateway;

    constructor(scope: Construct, id: string, props: ToolsStackProps) {
        super(scope, id, props);

        // ---------- 1. DynamoDB tables ----------
        const branchesTable = new dynamodb.TableV2(this, 'BranchesTableDummyBanking', {
            partitionKey: { name: 'city', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'branch_id', type: dynamodb.AttributeType.STRING },
            billing: dynamodb.Billing.onDemand(),
            encryption: dynamodb.TableEncryptionV2.awsManagedKey(),
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        const loanProductsTable = new dynamodb.TableV2(this, 'LoanProductsTableDummyBanking', {
            partitionKey: { name: 'product_type', type: dynamodb.AttributeType.STRING },
            billing: dynamodb.Billing.onDemand(),
            encryption: dynamodb.TableEncryptionV2.awsManagedKey(),
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // ---------- 2. Lambda functions (one per tool domain) ----------
        const commonProps = {
            runtime: lambda.Runtime.PYTHON_3_13,
            architecture: lambda.Architecture.ARM_64,
            handler: 'handler.lambda_handler',
            timeout: cdk.Duration.seconds(10),
            memorySize: 256,
        };

        const branchToolsFn = new lambda.Function(this, 'BranchToolsFn', {
            ...commonProps,
            description: 'Branch status and representative tools for AgentCore Gateway',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/branch_tools')),
            environment: { BRANCHES_TABLE: branchesTable.tableName },
            logGroup: new logs.LogGroup(this, 'BranchToolsLogs', {
                retention: logs.RetentionDays.ONE_WEEK,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            }),
        });
        branchesTable.grantReadData(branchToolsFn); // read-only: least privilege

        const loanToolsFn = new lambda.Function(this, 'LoanToolsFn', {
            ...commonProps,
            description: 'Loan eligibility and EMI tools for AgentCore Gateway',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/loan_tools')),
            environment: { LOAN_PRODUCTS_TABLE: loanProductsTable.tableName },
            logGroup: new logs.LogGroup(this, 'LoanToolsLogs', {
                retention: logs.RetentionDays.ONE_WEEK,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            }),
        });
        loanProductsTable.grantReadData(loanToolsFn);

        // ---------- 3. AgentCore Gateway (MCP server) ----------
        this.gateway = new agentcore.Gateway(this, 'ToolsGateway', {
            gatewayName: 'horizon-bank-tools',
            description: 'MCP tools for the Horizon Bank assistant',
            // Inbound auth: callers must sign requests with IAM (SigV4).
            authorizerConfiguration: agentcore.GatewayAuthorizer.usingAwsIam(),
        });

        // ---------- 4. Targets: the tool contracts the agent will see ----------
        // The model chooses the tool beased on the description
        this.gateway.addLambdaTarget('BranchToolsTarget', {
            gatewayTargetName: 'branch-tools',
            description: 'Branch locations, live open/closed status and staffing',
            lambdaFunction: branchToolsFn,
            toolSchema: agentcore.ToolSchema.fromInline([
                {
                    name: 'list_branch_cities',
                    description: 'List all cities where Horizon Bank has at least one branch.',
                    inputSchema: { type: S.OBJECT, properties: {} },
                },
                {
                    name: 'get_branch_status',
                    description:
                        'Get whether each Horizon Bank branch in a city is open right now, with today\'s hours, weekly hours, address and services.',
                    inputSchema: {
                        type: S.OBJECT,
                        properties: {
                            city: { type: S.STRING, description: 'City name, for example "Chicago" or "New York".' },
                        },
                        required: ['city'],
                    },
                },
                {
                    name: 'get_branch_representatives',
                    description:
                        'Get how many representatives (tellers, customer service, loan officers) work at each branch in a city.',
                    inputSchema: {
                        type: S.OBJECT,
                        properties: {
                            city: { type: S.STRING, description: 'City name, for example "Boston".' },
                        },
                        required: ['city'],
                    },
                },
            ]),
        });

        this.gateway.addLambdaTarget('LoanToolsTarget', {
            gatewayTargetName: 'loan-tools',
            description: 'Loan products, indicative eligibility and repayment estimates',
            lambdaFunction: loanToolsFn,
            toolSchema: agentcore.ToolSchema.fromInline([
                {
                    name: 'list_loan_products',
                    description: 'List loan products with their current interest rates, limits and eligibility rules.',
                    inputSchema: { type: S.OBJECT, properties: {} },
                },
                {
                    name: 'check_loan_eligibility',
                    description:
                        'Check indicative loan eligibility using the bank\'s rules. Returns eligible true/false, reasons, and the indicative maximum amount.',
                    inputSchema: {
                        type: S.OBJECT,
                        properties: {
                            product_type: { type: S.STRING, description: 'One of: personal, car, home.' },
                            monthly_salary: { type: S.NUMBER, description: 'Gross monthly salary in USD. If the customer gave a range, use the LOWER bound.' },
                            existing_monthly_debt: { type: S.NUMBER, description: 'Total existing monthly debt repayments in USD. Use 0 if none.' },
                            requested_amount: { type: S.NUMBER, description: 'Loan amount requested in USD, if the customer gave one.' },
                            tenure_months: { type: S.INTEGER, description: 'Requested loan term in months, if given.' },
                        },
                        required: ['product_type', 'monthly_salary'],
                    },
                },
                {
                    name: 'calculate_emi',
                    description: 'Calculate the monthly repayment (EMI), total repayment and total interest for a loan.',
                    inputSchema: {
                        type: S.OBJECT,
                        properties: {
                            principal: { type: S.NUMBER, description: 'Loan amount in USD.' },
                            annual_interest_rate: { type: S.NUMBER, description: 'Annual interest rate in percent, for example 7.9.' },
                            tenure_months: { type: S.INTEGER, description: 'Loan term in months.' },
                        },
                        required: ['principal', 'annual_interest_rate', 'tenure_months'],
                    },
                },
            ]),
        });

        // ---------- 5. Outputs ----------
        new cdk.CfnOutput(this, 'GatewayUrl', { value: this.gateway.gatewayUrl! });
        new cdk.CfnOutput(this, 'GatewayId', { value: this.gateway.gatewayId });
        new cdk.CfnOutput(this, 'BranchesTableName', { value: branchesTable.tableName });
        new cdk.CfnOutput(this, 'LoanProductsTableName', { value: loanProductsTable.tableName });
        new cdk.CfnOutput(this, 'BranchToolsFunctionName', { value: branchToolsFn.functionName });
        new cdk.CfnOutput(this, 'LoanToolsFunctionName', { value: loanToolsFn.functionName });
    }
}