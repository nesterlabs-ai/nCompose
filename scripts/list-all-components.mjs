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
  // Get component sets count
  const resp = await figmaGet(`/v1/files/${FILE_KEY}/component_sets`);
  const sets = resp.meta?.component_sets || [];
  console.log(`Total component sets: ${sets.length}`);
  sets.forEach(cs => console.log(`  CS: "${cs.name}" => ${cs.node_id}`));

  // Get components count
  const resp2 = await figmaGet(`/v1/files/${FILE_KEY}/components`);
  const comps = resp2.meta?.components || [];
  console.log(`\nTotal components: ${comps.length}`);
  comps.slice(0, 50).forEach(c => console.log(`  C: "${c.name}" => ${c.node_id}  (frame: ${c.containing_frame?.name || 'N/A'})`));
  if (comps.length > 50) console.log(`  ... and ${comps.length - 50} more`);
}

main().catch(console.error);
