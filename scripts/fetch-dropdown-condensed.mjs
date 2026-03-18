#!/usr/bin/env node
/**
 * Fetch and print a CONDENSED Figma node tree for "Dropdown with Columns" (9485:1709).
 * Collapses repeated sibling patterns and icon internals.
 */
import https from 'node:https';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = 'rAim3nrWukuYQQRmYU1L8r';

const NODE_IDS = ['9485:1709'];

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

// Create a signature for a node to detect repetition
function nodeSignature(node) {
  return `${node.type}|${node.name}|${node.componentId || ''}`;
}

function walkNode(node, depth = 0, parentChildren = null, siblingIndex = 0) {
  const indent = '  '.repeat(depth);
  const visible = node.visible === false ? ' [HIDDEN]' : '';
  let extra = '';

  // Skip deep internals of icon/vector nodes
  if (depth > 2 && (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' || node.type === 'ELLIPSE' || node.type === 'LINE')) {
    return;
  }

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
        if (v.variantOptions) s += `,opts=[${v.variantOptions.join('|')}]`;
        s += ')';
        return s;
      });
      extra += `  propertyDefs={${defStrs.join(', ')}}`;
    }
  }

  if (node.type === 'TEXT' && node.characters) {
    extra += `  text="${node.characters.slice(0, 60)}"`;
  }

  if (node.absoluteBoundingBox) {
    const b = node.absoluteBoundingBox;
    extra += `  [${Math.round(b.width)}x${Math.round(b.height)}]`;
  }

  console.log(`${indent}[${node.type}] "${node.name}"${visible}${extra}`);

  if (!node.children) return;

  // Detect repeated siblings - group by signature
  const children = node.children;
  let i = 0;
  while (i < children.length) {
    const sig = nodeSignature(children[i]);
    // Count consecutive siblings with same signature pattern (e.g., "item row N")
    let baseName = children[i].name.replace(/\d+$/, '').trim();
    let count = 1;
    while (i + count < children.length) {
      let nextBaseName = children[i + count].name.replace(/\d+$/, '').trim();
      if (nextBaseName === baseName && children[i + count].type === children[i].type) {
        count++;
      } else {
        break;
      }
    }

    if (count > 2) {
      // Print first, then "... (N-2 more)", then last
      walkNode(children[i], depth + 1);
      console.log(`${indent}  ... (${count - 2} more "${baseName}" siblings with same structure)`);
      walkNode(children[i + count - 1], depth + 1);
    } else {
      for (let j = 0; j < count; j++) {
        walkNode(children[i + j], depth + 1);
      }
    }
    i += count;
  }
}

async function main() {
  const encoded = NODE_IDS.map(id => encodeURIComponent(id)).join(',');
  const resp = await figmaGet(`/v1/files/${FILE_KEY}/nodes?ids=${encoded}`);

  const nodes = resp.nodes;
  for (const [id, entry] of Object.entries(nodes)) {
    if (entry.document) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`NODE: ${id} -- "${entry.document.name}" (${entry.document.type})`);
      console.log(`${'='.repeat(80)}`);
      walkNode(entry.document, 0);
    }
  }
}

main().catch(console.error);
