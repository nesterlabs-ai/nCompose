/**
 * Inspect the Figma component set structure to understand variants.
 */
import 'dotenv/config';
import { parseFigmaUrl } from '../src/utils/figma-url-parser.js';
import { FigmaClient } from '../src/figma/fetch.js';
import { simplifyFigmaData } from '../src/figma/simplify.js';
import { dump } from 'js-yaml';
import { writeFileSync } from 'node:fs';

const url = 'https://www.figma.com/design/rAim3nrWukuYQQRmYU1L8r/SquareX-Design-System--Copy-?node-id=8119-29710&m=dev';

async function main() {
  const { fileKey, nodeId } = parseFigmaUrl(url);
  const client = new FigmaClient(process.env.FIGMA_TOKEN!);

  // Fetch with depth 2 to see variant structure without going too deep
  const rawData = await client.getNode(fileKey, nodeId!, 2);

  const nodeKey = Object.keys(rawData.nodes)[0];
  const doc = (rawData.nodes as any)[nodeKey]?.document;

  console.log('Node type:', doc?.type);
  console.log('Node name:', doc?.name);
  console.log('Children count:', doc?.children?.length);
  console.log();

  // Show variant names and properties
  if (doc?.children) {
    for (const child of doc.children) {
      const props = child.componentProperties || child.name;
      console.log(`  [${child.type}] ${child.name}`);
    }
  }

  // Save simplified YAML for inspection
  const simplified = simplifyFigmaData(rawData, { maxDepth: 3 });
  const yamlStr = dump(simplified, { lineWidth: 120, noRefs: true });
  writeFileSync('./output/debug-component-set.yaml', yamlStr);
  console.log(`\nSimplified YAML saved (${yamlStr.length} chars)`);

  // Show first 200 lines
  const lines = yamlStr.split('\n');
  console.log(`\nFirst 100 lines of YAML:\n`);
  console.log(lines.slice(0, 100).join('\n'));
}

main().catch(console.error);
