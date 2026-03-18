#!/usr/bin/env node
/**
 * Inspect the Figma node tree for "DropdownWithColumns" / "Dropdown With Columns".
 *
 * 1. Fetches the file's component list to find the node-id.
 * 2. Fetches the full node subtree via /v1/files/{key}/nodes?ids={id}
 * 3. Recursively prints every node: name, type, visible, depth.
 *    For INSTANCE nodes, also prints componentProperties keys.
 */

import https from 'node:https';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = 'rAim3nrWukuYQQRmYU1L8r';

if (!TOKEN) {
  console.error('FIGMA_TOKEN not set');
  process.exit(1);
}

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

// ---------- Step 1: find the node ID ----------
async function findComponentNodeId() {
  const resp = await figmaGet(`/v1/files/${FILE_KEY}/components`);
  const meta = resp.meta;
  if (!meta || !meta.components) {
    console.error('No components metadata found');
    return null;
  }
  const needle = ['dropdownwithcolumns', 'dropdown with columns', 'dropdown_with_columns'];
  for (const comp of meta.components) {
    const name = (comp.name || '').toLowerCase().replace(/\s+/g, ' ');
    if (needle.some((n) => name.includes(n))) {
      console.error(`Found component: "${comp.name}" => node_id=${comp.node_id}, containing_frame=${JSON.stringify(comp.containing_frame)}`);
      return comp.node_id;
    }
  }

  // Also check component_sets
  const resp2 = await figmaGet(`/v1/files/${FILE_KEY}/component_sets`);
  if (resp2.meta && resp2.meta.component_sets) {
    for (const cs of resp2.meta.component_sets) {
      const name = (cs.name || '').toLowerCase().replace(/\s+/g, ' ');
      if (needle.some((n) => name.includes(n))) {
        console.error(`Found component set: "${cs.name}" => node_id=${cs.node_id}`);
        return cs.node_id;
      }
    }
  }

  // Dump all component names for debugging
  console.error('\n--- All components (looking for dropdown-related) ---');
  for (const comp of meta.components) {
    const name = (comp.name || '').toLowerCase();
    if (name.includes('dropdown') || name.includes('select') || name.includes('column')) {
      console.error(`  "${comp.name}" => ${comp.node_id}`);
    }
  }
  if (resp2.meta && resp2.meta.component_sets) {
    console.error('\n--- All component sets (looking for dropdown-related) ---');
    for (const cs of resp2.meta.component_sets) {
      const name = (cs.name || '').toLowerCase();
      if (name.includes('dropdown') || name.includes('select') || name.includes('column')) {
        console.error(`  "${cs.name}" => ${cs.node_id}`);
      }
    }
  }

  return null;
}

// ---------- Step 2: fetch & walk tree ----------
function walkNode(node, depth = 0) {
  const indent = '  '.repeat(depth);
  const visible = node.visible === false ? ' [HIDDEN]' : '';
  let extra = '';

  if (node.type === 'INSTANCE') {
    const propKeys = node.componentProperties
      ? Object.keys(node.componentProperties)
      : [];
    if (propKeys.length > 0) {
      extra = `  componentProperties=[${propKeys.join(', ')}]`;
    }
    if (node.componentId) {
      extra += `  componentId=${node.componentId}`;
    }
  }

  // Show component property definitions on COMPONENT / COMPONENT_SET
  if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && node.componentPropertyDefinitions) {
    const defs = Object.keys(node.componentPropertyDefinitions);
    if (defs.length > 0) {
      extra += `  propertyDefs=[${defs.join(', ')}]`;
    }
  }

  console.log(`${indent}[${node.type}] "${node.name}"${visible}${extra}`);

  if (node.children) {
    for (const child of node.children) {
      walkNode(child, depth + 1);
    }
  }
}

async function main() {
  let nodeId = await findComponentNodeId();

  if (!nodeId) {
    console.error('\nCould not find DropdownWithColumns component. Trying broader search on file...');
    // Try getting the full file and searching
    // This is expensive, so let's try with depth=1 first
    process.exit(1);
  }

  console.error(`\nFetching node tree for ${nodeId}...`);
  const encoded = encodeURIComponent(nodeId);
  const resp = await figmaGet(`/v1/files/${FILE_KEY}/nodes?ids=${encoded}&depth=50`);

  const nodes = resp.nodes;
  if (!nodes) {
    console.error('No nodes returned');
    process.exit(1);
  }

  for (const [id, entry] of Object.entries(nodes)) {
    if (entry.document) {
      console.log(`\n=== Node ${id} ===`);
      walkNode(entry.document, 0);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
