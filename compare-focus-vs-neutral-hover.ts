import { FigmaClient } from './src/figma/fetch.js';
import { extractCompleteDesign, allExtractors } from './src/figma-complete/index.js';
import { parseComponentSet } from './src/figma/component-set-parser.js';
import 'dotenv/config';

const client = new FigmaClient(process.env.FIGMA_TOKEN!);
const fileKey = 'rAim3nrWukuYQQRmYU1L8r';
const nodeId = '8119:29710';

async function compareVariants() {
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

  console.log('=== COMPARING FOCUS vs NEUTRAL/HOVER ===\n');

  // Focus variant (has visible border in Figma)
  const focusNode = enhanced?.nodes?.[0]?.children?.find((c: any) =>
    c.name?.includes('Style=Subtle') && c.name?.includes('State=Focus') && c.name?.includes('Size=Medium')
  );

  console.log('SUBTLE/FOCUS/MEDIUM (has visible border):');
  console.log('  Raw strokes:', JSON.stringify(focusNode?.strokes, null, 2));
  if (focusNode?.strokes?.[0]) {
    const s = focusNode.strokes[0];
    console.log('  stroke.visible:', s.visible);
    console.log('  stroke.opacity:', s.opacity);
    console.log('  "visible" key exists:', 'visible' in s);
  }

  // Neutral hover variant (user says NO visible border)
  const neutralHoverNode = enhanced?.nodes?.[0]?.children?.find((c: any) =>
    c.name?.includes('Style=Neutral') && c.name?.includes('State=Hover') && c.name?.includes('Size=Medium')
  );

  console.log('\n\nNEUTRAL/HOVER/MEDIUM (user says NO visible border):');
  console.log('  Raw strokes:', JSON.stringify(neutralHoverNode?.strokes, null, 2));
  if (neutralHoverNode?.strokes?.[0]) {
    const s = neutralHoverNode.strokes[0];
    console.log('  stroke.visible:', s.visible);
    console.log('  stroke.opacity:', s.opacity);
    console.log('  "visible" key exists:', 'visible' in s);
  }

  // Neutral default variant (for comparison)
  const neutralDefaultNode = enhanced?.nodes?.[0]?.children?.find((c: any) =>
    c.name?.includes('Style=Neutral') && c.name?.includes('State=Default') && c.name?.includes('Size=Medium')
  );

  console.log('\n\nNEUTRAL/DEFAULT/MEDIUM (for comparison):');
  console.log('  Raw strokes:', JSON.stringify(neutralDefaultNode?.strokes, null, 2));
  if (neutralDefaultNode?.strokes?.[0]) {
    const s = neutralDefaultNode.strokes[0];
    console.log('  stroke.visible:', s.visible);
    console.log('  stroke.opacity:', s.opacity);
    console.log('  "visible" key exists:', 'visible' in s);
  }

  // Check variant styles
  console.log('\n\n=== PARSED VARIANT STYLES ===\n');

  const subtleFocus = componentSetData.variants.find(v =>
    v.props['Style'] === 'Subtle' && v.props['State'] === 'Focus' && v.props['Size'] === 'Medium'
  );
  console.log('Subtle/Focus/Medium border:', subtleFocus?.styles.container['border']);

  const neutralHover = componentSetData.variants.find(v =>
    v.props['Style'] === 'Neutral' && v.props['State'] === 'Hover' && v.props['Size'] === 'Medium'
  );
  console.log('Neutral/Hover/Medium border:', neutralHover?.styles.container['border']);

  const neutralDefault = componentSetData.variants.find(v =>
    v.props['Style'] === 'Neutral' && v.props['State'] === 'Default' && v.props['Size'] === 'Medium'
  );
  console.log('Neutral/Default/Medium border:', neutralDefault?.styles.container['border']);

  // Summary
  console.log('\n\n=== KEY DIFFERENCES ===');
  console.log('Focus stroke has visible=true:', focusNode?.strokes?.[0]?.visible === true);
  console.log('Neutral/Hover stroke has visible=true:', neutralHoverNode?.strokes?.[0]?.visible === true);
  console.log('Neutral/Hover stroke has visible=undefined:', neutralHoverNode?.strokes?.[0]?.visible === undefined);
  console.log('Neutral/Default stroke has visible=true:', neutralDefaultNode?.strokes?.[0]?.visible === true);
}

compareVariants().catch(console.error);
