/**
 * Lazy-initialized DynamoDB Document Client singleton.
 * Only created when DYNAMODB_TABLE_NAME is set.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { config } from '../../config.js';

let docClient: DynamoDBDocumentClient | null = null;

export function isDynamoEnabled(): boolean {
  return Boolean(config.dynamo.tableName);
}

export function getTableName(): string {
  return config.dynamo.tableName;
}

export function getDocClient(): DynamoDBDocumentClient {
  if (!docClient) {
    const clientConfig: ConstructorParameters<typeof DynamoDBClient>[0] = {
      region: config.dynamo.region,
    };
    if (config.dynamo.endpoint) {
      clientConfig.endpoint = config.dynamo.endpoint;
    }
    const baseClient = new DynamoDBClient(clientConfig);
    docClient = DynamoDBDocumentClient.from(baseClient, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClient;
}
