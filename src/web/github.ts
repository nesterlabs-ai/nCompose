/**
 * GitHub API functions for OAuth and Git Data API operations.
 * Pure functions — no Express coupling. Uses Node 22 built-in fetch.
 */

import crypto from 'crypto';
import { config } from '../config.js';

// ── Helper ────────────────────────────────────────────────────────────────

async function githubFetch(url: string, token: string | null, options: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'figma-to-code',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = (body as any)?.message || (body as any)?.error_description || `GitHub API error: ${res.status}`;
    const err = new Error(msg);
    (err as any).status = res.status;
    throw err;
  }

  return body;
}

// ── OAuth ─────────────────────────────────────────────────────────────────

export function getOAuthUrl(redirectUri: string): { url: string; state: string } {
  const { clientId } = config.github;
  if (!clientId) throw new Error('GITHUB_CLIENT_ID is not configured');

  const state = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'repo',
    state,
  });

  return {
    url: `https://github.com/login/oauth/authorize?${params}`,
    state,
  };
}

export async function exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string }> {
  const { clientId, clientSecret } = config.github;
  if (!clientId || !clientSecret) throw new Error('GitHub OAuth is not configured');

  const data = await githubFetch('https://github.com/login/oauth/access_token', null, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const accessToken = data.access_token;
  if (!accessToken) {
    throw new Error(data.error_description || data.error || 'Failed to exchange code for token');
  }

  return { accessToken };
}

// ── User & Repos ──────────────────────────────────────────────────────────

export async function getUser(token: string): Promise<any> {
  return githubFetch('https://api.github.com/user', token);
}

export async function getRepos(token: string): Promise<any[]> {
  return githubFetch('https://api.github.com/user/repos?sort=updated&per_page=100', token);
}

export async function createRepo(
  token: string,
  name: string,
  description: string,
  isPrivate: boolean,
): Promise<any> {
  return githubFetch('https://api.github.com/user/repos', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description,
      private: isPrivate,
      auto_init: true,
    }),
  });
}

// ── Push (Git Data API — atomic 5-step commit) ───────────────────────────

interface PushFile {
  path: string;
  content: string;
}

export async function pushFiles(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  message: string,
  files: PushFile[],
): Promise<{ commitUrl: string }> {
  const base = `https://api.github.com/repos/${owner}/${repo}`;

  // 1. Get latest commit SHA on branch
  const ref = await githubFetch(`${base}/git/ref/heads/${branch}`, token);
  const latestCommitSha: string = ref.object.sha;

  // 2. Get base tree SHA from that commit
  const commit = await githubFetch(`${base}/git/commits/${latestCommitSha}`, token);
  const baseTreeSha: string = commit.tree.sha;

  // 3. Create new tree with all files
  const tree = files.map((f) => ({
    path: f.path,
    mode: '100644' as const,
    type: 'blob' as const,
    content: f.content,
  }));

  const newTree = await githubFetch(`${base}/git/trees`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: baseTreeSha, tree }),
  });

  // 4. Create new commit
  const newCommit = await githubFetch(`${base}/git/commits`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      tree: newTree.sha,
      parents: [latestCommitSha],
    }),
  });

  // 5. Update branch ref to new commit
  await githubFetch(`${base}/git/refs/heads/${branch}`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: newCommit.sha }),
  });

  return {
    commitUrl: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}`,
  };
}
