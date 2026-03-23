/**
 * DynamoDB repository for free-tier usage tracking.
 *
 * Entity: PK=FP#{fingerprint}, SK=USAGE
 * Stores conversion count with 365-day TTL.
 */
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, getTableName } from './dynamo-client.js';

const TTL_DAYS = 365;

function buildKey(fingerprint: string) {
  return { PK: `FP#${fingerprint}`, SK: 'USAGE' };
}

export async function getFreeTierUsage(fingerprint: string): Promise<number> {
  const res = await getDocClient().send(
    new GetCommand({
      TableName: getTableName(),
      Key: buildKey(fingerprint),
      ProjectionExpression: 'used',
    }),
  );
  return (res.Item?.used as number) ?? 0;
}

export async function incrementFreeTierUsage(fingerprint: string): Promise<number> {
  const ttl = Math.floor(Date.now() / 1000) + TTL_DAYS * 86400;
  const res = await getDocClient().send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: buildKey(fingerprint),
      UpdateExpression: 'SET used = if_not_exists(used, :zero) + :inc, #ttl = :ttl',
      ExpressionAttributeNames: { '#ttl': 'TTL' },
      ExpressionAttributeValues: { ':zero': 0, ':inc': 1, ':ttl': ttl },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return (res.Attributes?.used as number) ?? 1;
}
