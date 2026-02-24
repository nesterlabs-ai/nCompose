import { FigmaClient } from './src/figma/fetch.js';
import { extractCompleteDesign, allExtractors } from './src/figma-complete/index.js';
import { parseComponentSet } from './src/figma/component-set-parser.js';
import 'dotenv/config';

const client = new FigmaClient(process.env.FIGMA_TOKEN!);
const fileKey = 'rAim3nrWukuYQQRmYU1L8r';
const nodeId = '8119:29710';

async function checkAllBorders() {
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

  console.log('=== ALL VARIANTS BORDER ANALYSIS ===\n');

  // Group variants by their border properties
  const withBorders: any[] = [];
  const noBorders: any[] = [];

  for (const variant of componentSetData.variants) {
    const border = variant.styles.container['border'];
    const variantName = `${variant.props['Style']}/${variant.props['State']}/${variant.props['Size']}`;

    if (border) {
      withBorders.push({ name: variantName, border, props: variant.props });
    } else {
      noBorders.push({ name: variantName, props: variant.props });
    }
  }

  console.log(`Total variants: ${componentSetData.variants.length}`);
  console.log(`Variants WITH borders: ${withBorders.length}`);
  console.log(`Variants WITHOUT borders: ${noBorders.length}\n`);

  console.log('=== VARIANTS WITH BORDERS ===\n');

  // Group by border value
  const borderGroups = new Map<string, string[]>();
  for (const v of withBorders) {
    if (!borderGroups.has(v.border)) {
      borderGroups.set(v.border, []);
    }
    borderGroups.get(v.border)!.push(v.name);
  }

  for (const [border, variants] of borderGroups) {
    console.log(`Border: ${border}`);
    console.log(`Variants (${variants.length}):`);
    for (const name of variants) {
      console.log(`  - ${name}`);
    }
    console.log();
  }

  console.log('\n=== VARIANTS WITHOUT BORDERS ===\n');
  for (const v of noBorders) {
    console.log(`  - ${v.name}`);
  }

  // Analyze patterns
  console.log('\n\n=== PATTERN ANALYSIS ===\n');

  const focusVariants = withBorders.filter(v => v.props['State'] === 'Focus');
  const neutralVariants = withBorders.filter(v => v.props['Style'] === 'Neutral');
  const otherVariants = withBorders.filter(v => v.props['State'] !== 'Focus' && v.props['Style'] !== 'Neutral');

  console.log(`Focus state variants with borders: ${focusVariants.length}/6 (expected 6)`);
  console.log(`Neutral style variants with borders: ${neutralVariants.length}/6 (all neutral variants)`);
  console.log(`Other variants with borders: ${otherVariants.length}`);

  if (otherVariants.length > 0) {
    console.log('\nOther (non-Focus, non-Neutral) variants with borders:');
    for (const v of otherVariants) {
      console.log(`  - ${v.name}: ${v.border}`);
    }
  }

  // Raw stroke data analysis
  console.log('\n\n=== RAW STROKE DATA ANALYSIS ===\n');

  const allNodes = enhanced?.nodes?.[0]?.children || [];

  console.log('Checking ALL variant nodes for stroke data...\n');

  for (const node of allNodes) {
    const hasStroke = node.strokes && node.strokes.length > 0;
    const strokeVisible = hasStroke && node.strokes[0].visible === true;
    const strokeOpacity = hasStroke ? node.strokes[0].opacity : undefined;
    const strokeColor = hasStroke ? node.strokes[0].color : undefined;

    if (hasStroke) {
      console.log(node.name);
      console.log(`  has strokes: ${hasStroke}`);
      console.log(`  visible: ${strokeVisible}`);
      console.log(`  opacity: ${strokeOpacity}`);
      if (strokeColor) {
        const r = Math.round(strokeColor.r * 255);
        const g = Math.round(strokeColor.g * 255);
        const b = Math.round(strokeColor.b * 255);
        console.log(`  color: rgb(${r}, ${g}, ${b})`);
      }
      console.log();
    }
  }
}

checkAllBorders().catch(console.error);
