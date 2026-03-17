#!/usr/bin/env node
/**
 * Search the Figma file tree for nodes named "DropdownWithColumns" or similar.
 * Uses GET /v1/files/{key} with depth=3 to get the page-level structure,
 * then searches deeper in matching branches.
 */
import https from 'node:https';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = 'rAim3nrWukuYQQRmYU1L8r';

function figmaGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = `https://api.figma.com${urlPath}`;
    console.error(`>> GET ${url}`);
    const req = https.get(url, { headers: { 'X-Figma-Token': TOKEN } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
          return;
        }
        resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
  });
}

function searchNode(node, depth = 0, matches = []) {
  const name = (node.name || '').toLowerCase().replace(/\s+/g, '');
  if (name.includes('dropdown') || name.includes('dropdownwithcolumn')) {
    matches.push({
      id: node.id,
      name: node.name,
      type: node.type,
      depth,
    });
  }
  if (node.children) {
    for (const child of node.children) {
      searchNode(child, depth + 1, matches);
    }
  }
  return matches;
}

async function main() {
  // Fetch with depth=4 to get into component-level nodes
  console.error('Fetching file structure (depth=4)...');
  const resp = await figmaGet(`/v1/files/${FILE_KEY}?depth=4`);

  const doc = resp.document;
  if (!doc) {
    console.error('No document in response');
    process.exit(1);
  }

  // List pages first
  console.log('=== PAGES ===');
  for (const page of doc.children || []) {
    console.log(`  Page: "${page.name}" (${page.id}) - ${(page.children || []).length} top-level children`);
  }

  // Search for dropdown-related nodes
  const matches = searchNode(doc);
  console.log(`\n=== MATCHES for "dropdown" (${matches.length}) ===`);
  for (const m of matches) {
    console.log(`  [${m.type}] "${m.name}" => ${m.id} (depth=${m.depth})`);
  }

  // If no matches, list all top-level frames in each page
  if (matches.length === 0) {
    console.log('\n=== ALL TOP-LEVEL FRAMES (depth=2) ===');
    for (const page of doc.children || []) {
      console.log(`\nPage: "${page.name}"`);
      for (const frame of (page.children || []).slice(0, 100)) {
        console.log(`  [${frame.type}] "${frame.name}" => ${frame.id}`);
      }
    }
  }
}

main().catch(console.error);
