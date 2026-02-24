#!/usr/bin/env tsx
import 'dotenv/config';
import { FigmaClient } from '../src/figma/fetch.js';
import { extractCompleteDesign, allExtractors } from '../src/figma-complete/index.js';
import { parseComponentSet } from '../src/figma/component-set-parser.js';

async function main() {
  const client = new FigmaClient(process.env.FIGMA_TOKEN!);
  const rawData = await client.getNode('rAim3nrWukuYQQRmYU1L8r', '8119:29710', 25);
  const design = extractCompleteDesign(rawData, allExtractors, { maxDepth: 25 });
  const componentSetData = parseComponentSet(design);

  if (!componentSetData) {
    console.error('Failed to parse component set');
    return;
  }

  console.log('=== Icon Colors Across Variants ===\n');

  // Check a few key variants
  const testVariants = [
    { Style: 'Subtle', State: 'Default', Size: 'Medium' },
    { Style: 'Neutral', State: 'Default', Size: 'Medium' },
    { Style: 'Primary', State: 'Default', Size: 'Medium' },
    { Style: 'Subtle', State: 'Disabled', Size: 'Medium' },
    { Style: 'Primary', State: 'Hover', Size: 'Medium' },
  ];

  const rootNode = design.nodes[0];

  for (const testProps of testVariants) {
    const variantName = `Style=${testProps.Style}, State=${testProps.State}, Size=${testProps.Size}`;
    const variantNode = rootNode.children.find((c: any) => c.name === variantName);

    if (!variantNode) continue;

    console.log(`\n=== ${variantName} ===`);

    // Find Left Icon child
    const leftIcon = variantNode.children?.find((c: any) => c.name === 'Left Icon');
    if (leftIcon) {
      console.log('\nLeft Icon:');
      console.log('  size:', leftIcon.absoluteBoundingBox?.width, 'x', leftIcon.absoluteBoundingBox?.height);

      // Check color from fills
      if (leftIcon.fills && Array.isArray(leftIcon.fills)) {
        console.log('  fills:', JSON.stringify(leftIcon.fills, null, 2));
      }

      // Check if there's a Star child with color
      const starChild = leftIcon.children?.find((c: any) => c.name === 'Star');
      if (starChild) {
        console.log('\n  Star child:');
        if (starChild.fills && Array.isArray(starChild.fills)) {
          console.log('    fills:', JSON.stringify(starChild.fills, null, 2));
        }
        if (starChild.strokes && Array.isArray(starChild.strokes)) {
          console.log('    strokes:', JSON.stringify(starChild.strokes, null, 2));
        }
      }

      // Check deeper for Vector
      if (starChild?.children) {
        for (const child of starChild.children) {
          if (child.name === 'Star' && child.children) {
            const vector = child.children.find((c: any) => c.type === 'VECTOR');
            if (vector) {
              console.log('\n  Vector child:');
              if (vector.fills && Array.isArray(vector.fills)) {
                console.log('    fills:', JSON.stringify(vector.fills, null, 2));
              }
              if (vector.strokes && Array.isArray(vector.strokes)) {
                console.log('    strokes:', JSON.stringify(vector.strokes, null, 2));
              }
            }
          }
        }
      }
    }
  }

  // Also check icon export settings
  console.log('\n\n=== Icon Export Settings ===');
  const leftIconNode = componentSetData.defaultVariantNode.children?.find((c: any) => c.name === 'Left Icon');
  if (leftIconNode) {
    console.log('Left Icon node ID:', leftIconNode.id);
    console.log('Dimensions:', leftIconNode.absoluteBoundingBox?.width, 'x', leftIconNode.absoluteBoundingBox?.height);
    console.log('Export settings:', leftIconNode.exportSettings);
  }
}

main().catch(console.error);
