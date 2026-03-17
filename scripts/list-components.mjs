#!/usr/bin/env node
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

async function main() {
  // List all component sets
  const resp = await figmaGet(`/v1/files/${FILE_KEY}/component_sets`);
  console.log('=== COMPONENT SETS ===');
  if (resp.meta?.component_sets) {
    for (const cs of resp.meta.component_sets) {
      console.log(`  "${cs.name}" => ${cs.node_id}  (frame: ${cs.containing_frame?.name || 'N/A'})`);
    }
  }

  // List all components
  const resp2 = await figmaGet(`/v1/files/${FILE_KEY}/components`);
  console.log('\n=== COMPONENTS (filtered: dropdown/select/column/chip/check/multi) ===');
  if (resp2.meta?.components) {
    for (const comp of resp2.meta.components) {
      const name = (comp.name || '').toLowerCase();
      if (name.includes('drop') || name.includes('select') || name.includes('column') ||
          name.includes('chip') || name.includes('check') || name.includes('multi') ||
          name.includes('filter') || name.includes('menu') || name.includes('popover') ||
          name.includes('picker')) {
        console.log(`  "${comp.name}" => ${comp.node_id}  (frame: ${comp.containing_frame?.name || 'N/A'})`);
      }
    }
  }
}

main().catch(console.error);
