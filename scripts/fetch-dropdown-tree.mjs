#!/usr/bin/env node
/**
 * Fetch and print the full Figma node tree for "Dropdown with Columns" (9485:1709)
 * and its related component sets.
 */
import https from 'node:https';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = 'rAim3nrWukuYQQRmYU1L8r';

// The main "Dropdown with Columns" instance and related component sets
const NODE_IDS = [
  '9485:1709',  // "Dropdown with Columns" INSTANCE
  '9485:1618',  // "Dropdown Field" COMPONENT_SET
  '9485:1844',  // "Dropdown Column" COMPONENT_SET
  '9485:1879',  // "Dropdown Internal" COMPONENT_SET
  '9485:1925',  // "Dropdown Item Row" COMPONENT_SET
  '9485:1986',  // "Dropdown List of Items" COMPONENT_SET
];

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

function walkNode(node, depth = 0) {
  const indent = '  '.repeat(depth);
  const visible = node.visible === false ? ' [HIDDEN]' : '';
  let extra = '';

  if (node.type === 'INSTANCE') {
    const propKeys = node.componentProperties
      ? Object.keys(node.componentProperties)
      : [];
    if (propKeys.length > 0) {
      extra += `  props=[${propKeys.join(', ')}]`;
    }
    if (node.componentId) {
      extra += `  componentId=${node.componentId}`;
    }
  }

  if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && node.componentPropertyDefinitions) {
    const defs = Object.entries(node.componentPropertyDefinitions);
    if (defs.length > 0) {
      const defStrs = defs.map(([k, v]) => {
        let s = `${k}(${v.type}`;
        if (v.defaultValue !== undefined) s += `=${JSON.stringify(v.defaultValue)}`;
        if (v.variantOptions) s += `,options=[${v.variantOptions.join('|')}]`;
        s += ')';
        return s;
      });
      extra += `  propertyDefs={${defStrs.join(', ')}}`;
    }
  }

  if (node.type === 'TEXT' && node.characters) {
    extra += `  text="${node.characters.slice(0, 80)}"`;
  }

  // Show size for layout understanding
  if (node.absoluteBoundingBox) {
    const b = node.absoluteBoundingBox;
    extra += `  [${Math.round(b.width)}x${Math.round(b.height)}]`;
  }

  console.log(`${indent}[${node.type}] "${node.name}"${visible}${extra}`);

  if (node.children) {
    for (const child of node.children) {
      walkNode(child, depth + 1);
    }
  }
}

async function main() {
  const encoded = NODE_IDS.map(id => encodeURIComponent(id)).join(',');
  const resp = await figmaGet(`/v1/files/${FILE_KEY}/nodes?ids=${encoded}`);

  const nodes = resp.nodes;
  if (!nodes) {
    console.error('No nodes returned');
    process.exit(1);
  }

  for (const [id, entry] of Object.entries(nodes)) {
    if (entry.document) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`NODE: ${id} — "${entry.document.name}" (${entry.document.type})`);
      console.log(`${'='.repeat(80)}`);
      walkNode(entry.document, 0);
    } else {
      console.log(`\nNODE ${id}: no document (error: ${JSON.stringify(entry)})`);
    }
  }
}

main().catch(console.error);
