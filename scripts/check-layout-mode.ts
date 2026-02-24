#!/usr/bin/env tsx
import 'dotenv/config';
import { FigmaClient } from '../src/figma/fetch.js';
import { extractCompleteDesign, allExtractors } from '../src/figma-complete/index.js';

async function main() {
  const client = new FigmaClient(process.env.FIGMA_TOKEN!);
  const rawData = await client.getNode('rAim3nrWukuYQQRmYU1L8r', '8119:29710', 25);
  const design = extractCompleteDesign(rawData, allExtractors, { maxDepth: 25 });
  const rootNode = design.nodes[0];
  const defaultVariant = rootNode.children[0];

  console.log('Root node:', rootNode.name);
  console.log('Default variant:', defaultVariant.name);
  console.log('\nLayout info:');
  console.log('  layoutMode:', defaultVariant.layoutMode);
  console.log('  primaryAxisSizingMode:', defaultVariant.primaryAxisSizingMode);
  console.log('  counterAxisSizingMode:', defaultVariant.counterAxisSizingMode);
  console.log('  absoluteBoundingBox.width:', defaultVariant.absoluteBoundingBox?.width);
  console.log('  absoluteBoundingBox.height:', defaultVariant.absoluteBoundingBox?.height);
}

main().catch(console.error);
