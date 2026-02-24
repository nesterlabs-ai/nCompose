#!/usr/bin/env tsx
import 'dotenv/config';
import { FigmaClient } from '../src/figma/fetch.js';
import { extractCompleteDesign, allExtractors } from '../src/figma-complete/index.js';
import { parseComponentSet } from '../src/figma/component-set-parser.js';
import { collectAssetNodes } from '../src/figma/asset-export.js';

async function main() {
  const client = new FigmaClient(process.env.FIGMA_TOKEN!);
  const rawData = await client.getNode('rAim3nrWukuYQQRmYU1L8r', '8119:29710', 25);

  console.log('=== Complete Extraction Debug ===\n');

  const design = extractCompleteDesign(rawData, allExtractors, { maxDepth: 25 });
  const componentSetData = parseComponentSet(design);

  if (!componentSetData) {
    console.error('Failed to parse component set');
    return;
  }

  console.log('Component:', componentSetData.name);
  console.log('Default variant:', componentSetData.defaultVariantNode.name);
  console.log('\nDefault variant structure:');

  function printNode(node: any, indent: number = 0) {
    const prefix = '  '.repeat(indent);
    console.log(`${prefix}- ${node.name} (type: ${node.type})`);
    console.log(`${prefix}  id: ${node.id}`);
    console.log(`${prefix}  children: ${node.children ? node.children.length : 0}`);

    if (node.absoluteBoundingBox) {
      console.log(`${prefix}  size: ${node.absoluteBoundingBox.width}x${node.absoluteBoundingBox.height}`);
    }

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        printNode(child, indent + 1);
      }
    }
  }

  printNode(componentSetData.defaultVariantNode);

  console.log('\n=== Collecting Asset Nodes ===\n');
  const assetNodes = collectAssetNodes(componentSetData.defaultVariantNode);

  console.log(`Found ${assetNodes.length} asset nodes:`);
  for (const asset of assetNodes) {
    console.log(`  - ${asset.name} (id: ${asset.id})`);
    if (asset.dimensions) {
      console.log(`    dimensions: ${asset.dimensions.width}x${asset.dimensions.height}`);
    }
  }

  if (assetNodes.length === 0) {
    console.log('\n⚠️  No asset nodes found!');
    console.log('This means the asset detection logic is not working with the complete extraction.');
  }
}

main().catch(console.error);
