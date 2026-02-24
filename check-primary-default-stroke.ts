import { FigmaClient } from './src/figma/fetch.js';
import { extractCompleteDesign, allExtractors } from './src/figma-complete/index.js';
import 'dotenv/config';

const client = new FigmaClient(process.env.FIGMA_TOKEN!);
const fileKey = 'rAim3nrWukuYQQRmYU1L8r';
const nodeId = '8119:29710';

async function checkPrimaryDefault() {
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

  const primaryDefaultSmall = enhanced?.nodes?.[0]?.children?.find((c: any) =>
    c.name?.includes('Style=Primary') && c.name?.includes('State=Default') && c.name?.includes('Size=Small')
  );

  console.log('=== PRIMARY/DEFAULT/SMALL STROKE DATA ===\n');
  console.log('Variant name:', primaryDefaultSmall?.name);
  console.log('Has strokes array:', !!primaryDefaultSmall?.strokes);
  console.log('Strokes array:', JSON.stringify(primaryDefaultSmall?.strokes, null, 2));
  console.log('strokeWeight:', primaryDefaultSmall?.strokeWeight);
  console.log('strokeAlign:', primaryDefaultSmall?.strokeAlign);

  // Check if it has any border-related properties
  console.log('\n=== BORDER PROPERTIES ===');
  console.log('Should have border in CSS:', !!primaryDefaultSmall?.strokes && primaryDefaultSmall.strokes.length > 0);
}

checkPrimaryDefault().catch(console.error);
