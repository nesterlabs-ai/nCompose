import { parseFigmaUrl } from '../../src/utils/figma-url-parser.js';
import { FigmaClient } from '../../src/figma/fetch.js';
import { extractCompleteDesign, allExtractors } from '../../src/figma-complete/index.js';
import { parseComponentSet, buildVariantCSS } from '../../src/figma/component-set-parser.js';
import * as fs from 'fs';

const url = 'https://www.figma.com/design/rAim3nrWukuYQQRmYU1L8r/SquareX-Design-System--Copy-?node-id=8119-29710&m=dev';
const token = process.env.FIGMA_TOKEN;

const { fileKey, nodeId } = parseFigmaUrl(url);
const client = new FigmaClient(token!);
const rawData = await client.getNode(fileKey, nodeId!, 20);

const completeDesign = extractCompleteDesign(rawData, allExtractors, {
  maxDepth: 20,
  preserveHiddenNodes: false,
  includeAbsoluteBoundingBox: true,
  includeRelativeTransform: true,
});

console.log('\n=== COMPLETE DESIGN ===');
console.log('Nodes:', completeDesign.nodes.length);
console.log('Component Sets:', Object.keys(completeDesign.componentSets).length);
console.log('Components:', Object.keys(completeDesign.components).length);

const componentSetData = parseComponentSet(completeDesign);

console.log('\n=== COMPONENT SET DATA ===');
console.log('Name:', componentSetData.name);
console.log('Variants:', componentSetData.variants.length);
console.log('Axes:', componentSetData.axes.map(a => `${a.name}(${a.values.length})`).join(', '));

console.log('\n=== DEFAULT VARIANT ===');
console.log('Props:', componentSetData.defaultVariant.props);
console.log('Styles:', JSON.stringify(componentSetData.defaultVariant.styles, null, 2));

console.log('\n=== FIRST NON-DEFAULT VARIANT ===');
const nonDefault = componentSetData.variants.find(v => v !== componentSetData.defaultVariant);
if (nonDefault) {
  console.log('Props:', nonDefault.props);
  console.log('Styles:', JSON.stringify(nonDefault.styles, null, 2));
}

const css = buildVariantCSS(componentSetData);
console.log('\n=== GENERATED CSS LENGTH ===', css.length, 'characters');
console.log('\n=== GENERATED CSS ===\n', css);

fs.writeFileSync('/tmp/debug-css.txt', css);
console.log('\nWrote CSS to /tmp/debug-css.txt');
