/**
 * DynamoDB repository for user projects and chat history.
 *
 * UserProject:  PK=USER#{sub}, SK=PROJ#{projectId}  (GSI1SK=PROJ#{updatedAt})
 * ProjectChat:  PK=USER#{sub}, SK=CHAT#{projectId}
 * FP-User Link: PK=FP#{fingerprint}, SK=OWNER
 */
import {
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { getDocClient, getTableName } from './dynamo-client.js';

const PROJECT_TTL_DAYS = 90;
const FP_TTL_DAYS = 365;

function projectTTL(): number {
  return Math.floor(Date.now() / 1000) + PROJECT_TTL_DAYS * 86400;
}

function fpTTL(): number {
  return Math.floor(Date.now() / 1000) + FP_TTL_DAYS * 86400;
}

// ── Project metadata (no generated code — stays on disk) ────────────────

export interface UserProjectRecord {
  projectId: string;
  sessionId: string;
  name: string;
  figmaUrl: string;
  frameworks: string[];
  createdAt: number;
  updatedAt: number;
}

export async function saveUserProject(userSub: string, project: UserProjectRecord): Promise<void> {
  const now = Date.now();
  const updatedAt = project.updatedAt || now;
  await getDocClient().send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: `USER#${userSub}`,
        SK: `PROJ#${project.projectId}`,
        GSI1PK: `USER#${userSub}`,
        GSI1SK: `PROJ#${updatedAt}`,
        ...project,
        updatedAt,
        TTL: projectTTL(),
      },
    }),
  );
}

export async function getUserProjects(userSub: string): Promise<UserProjectRecord[]> {
  const res = await getDocClient().send(
    new QueryCommand({
      TableName: getTableName(),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userSub}`,
        ':prefix': 'PROJ#',
      },
      ScanIndexForward: false, // newest first
    }),
  );
  return (res.Items ?? []).map(itemToProject);
}

export async function deleteUserProject(userSub: string, projectId: string): Promise<void> {
  // Delete both project and associated chat
  const table = getTableName();
  const client = getDocClient();
  await Promise.all([
    client.send(new DeleteCommand({ TableName: table, Key: { PK: `USER#${userSub}`, SK: `PROJ#${projectId}` } })),
    client.send(new DeleteCommand({ TableName: table, Key: { PK: `USER#${userSub}`, SK: `CHAT#${projectId}` } })),
  ]);
}

// ── Chat history ────────────────────────────────────────────────────────

export async function saveChatHistory(
  userSub: string,
  projectId: string,
  messages: Array<{ role: string; content: string }>,
): Promise<void> {
  await getDocClient().send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: `USER#${userSub}`,
        SK: `CHAT#${projectId}`,
        messages,
        TTL: projectTTL(),
      },
    }),
  );
}

export async function getChatHistory(
  userSub: string,
  projectId: string,
): Promise<Array<{ role: string; content: string }>> {
  const res = await getDocClient().send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: `USER#${userSub}`, SK: `CHAT#${projectId}` },
      ProjectionExpression: 'messages',
    }),
  );
  return (res.Item?.messages as Array<{ role: string; content: string }>) ?? [];
}

// ── Migration: localStorage → DynamoDB ──────────────────────────────────

export async function migrateLocalProjects(
  userSub: string,
  fingerprint: string | undefined,
  projects: Array<UserProjectRecord>,
): Promise<void> {
  if (projects.length === 0) return;

  const table = getTableName();
  const client = getDocClient();

  // BatchWrite in chunks of 25 (DynamoDB limit)
  const chunks: Array<typeof projects> = [];
  for (let i = 0; i < projects.length; i += 25) {
    chunks.push(projects.slice(i, i + 25));
  }

  for (const chunk of chunks) {
    const requests = chunk.map((p) => ({
      PutRequest: {
        Item: {
          PK: `USER#${userSub}`,
          SK: `PROJ#${p.projectId}`,
          GSI1PK: `USER#${userSub}`,
          GSI1SK: `PROJ#${p.updatedAt || Date.now()}`,
          ...p,
          TTL: projectTTL(),
        },
      },
    }));
    await client.send(new BatchWriteCommand({ RequestItems: { [table]: requests } }));
  }

  // Link fingerprint to user
  if (fingerprint) {
    await client.send(
      new PutCommand({
        TableName: table,
        Item: {
          PK: `FP#${fingerprint}`,
          SK: 'OWNER',
          userSub,
          TTL: fpTTL(),
        },
      }),
    );
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function itemToProject(item: Record<string, any>): UserProjectRecord {
  return {
    projectId: item.projectId,
    sessionId: item.sessionId,
    name: item.name,
    figmaUrl: item.figmaUrl,
    frameworks: item.frameworks ?? [],
    createdAt: item.createdAt ?? 0,
    updatedAt: item.updatedAt ?? 0,
  };
}
