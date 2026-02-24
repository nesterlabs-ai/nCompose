import { FigmaClient } from './src/figma/fetch.js';
import { extractCompleteDesign, allExtractors } from './src/figma-complete/index.js';
import { parseComponentSet, buildVariantCSS } from './src/figma/component-set-parser.js';
import 'dotenv/config';

const client = new FigmaClient(process.env.FIGMA_TOKEN!);
const fileKey = 'rAim3nrWukuYQQRmYU1L8r';
const nodeId = '8119:29710';

async function traceFocusStroke() {
  const rawData = await client.getFile(fileKey);

  function findNode(node: any, targetId: string): any {
    if (node.id === targetId) return node;
    if (node.children) {
      for (const child of node.children) {
        const found = findNode(child, targetId);
        if (found) return found;
      }
    }
    return null;
  }

  const targetNode = findNode(rawData.document, nodeId);
  const nodeResponse = {
    ...rawData,
    document: { ...rawData.document, children: [targetNode] },
  };

  const enhanced = extractCompleteDesign(nodeResponse, allExtractors, {
    maxDepth: 15,
    preserveHiddenNodes: false,
  });

  const componentSetData = parseComponentSet(enhanced);

  console.log('=== FOCUS VARIANT STROKE EXTRACTION ===\n');

  // Find subtle/focus/medium variant
  const subtleFocus = componentSetData.variants.find(v =>
    v.props['Style'] === 'Subtle' && v.props['State'] === 'Focus' && v.props['Size'] === 'Medium'
  );

  console.log('Subtle/Focus/Medium variant data:');
  console.log('  Props:', subtleFocus?.props);
  console.log('  Container CSS:', JSON.stringify(subtleFocus?.styles.container, null, 2));
  console.log('  Border in CSS:', subtleFocus?.styles.container['border']);

  // Find the actual node
  const focusNode = enhanced?.nodes?.[0]?.children?.find((c: any) =>
    c.name?.includes('Style=Subtle') && c.name?.includes('State=Focus') && c.name?.includes('Size=Medium')
  );

  console.log('\n\nRaw node stroke data:');
  console.log('  strokes:', JSON.stringify(focusNode?.strokes, null, 2));
  console.log('  strokeWeight:', focusNode?.strokeWeight);
  console.log('  strokeAlign:', focusNode?.strokeAlign);

  if (focusNode?.strokes?.[0]) {
    const stroke = focusNode.strokes[0];
    console.log('\n\nStroke color extraction:');
    console.log('  stroke.color.r:', stroke.color.r);
    console.log('  stroke.color.g:', stroke.color.g);
    console.log('  stroke.color.b:', stroke.color.b);
    console.log('  stroke.color.a:', stroke.color.a);
    console.log('  stroke.opacity:', stroke.opacity);

    // Manual calculation
    const r = Math.round(stroke.color.r * 255);
    const g = Math.round(stroke.color.g * 255);
    const b = Math.round(stroke.color.b * 255);
    const hex = `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

    console.log('  Calculated RGB:', `rgb(${r}, ${g}, ${b})`);
    console.log('  Calculated HEX:', hex);

    // Check opacity calculation
    const strokeOpacity = stroke.opacity !== undefined ? stroke.opacity : 1;
    const nodeOpacity = focusNode.opacity !== undefined ? focusNode.opacity : 1;
    const finalAlpha = (stroke.color.a || 1) * strokeOpacity * nodeOpacity;

    console.log('\n\nOpacity calculation:');
    console.log('  stroke.color.a:', stroke.color.a || 1);
    console.log('  stroke.opacity:', strokeOpacity);
    console.log('  node.opacity:', nodeOpacity);
    console.log('  final alpha:', finalAlpha);
    console.log('  Should use rgba?', finalAlpha < 1);
  }

  // Generate CSS and check the output
  const css = buildVariantCSS(componentSetData);
  const focusLines = css.split('\n').filter(line =>
    line.includes('data-focus') || (line.includes('border') && css.indexOf(line) > css.indexOf('data-focus'))
  );

  console.log('\n\nGenerated CSS for focus:');
  const focusSection = css.split('\n').slice(
    css.split('\n').findIndex(l => l.includes('--subtle[data-focus]')),
    css.split('\n').findIndex(l => l.includes('--subtle[data-focus]')) + 5
  );
  console.log(focusSection.join('\n'));

  // Check if all 3 focus variants get the same border
  console.log('\n\n=== ALL FOCUS VARIANTS ===');
  const focusVariants = componentSetData.variants.filter(v => v.props['State'] === 'Focus');
  for (const v of focusVariants) {
    console.log(`${v.props['Style']}/Focus/${v.props['Size']}:`);
    console.log('  Border:', v.styles.container['border']);
  }
}

traceFocusStroke().catch(console.error);
