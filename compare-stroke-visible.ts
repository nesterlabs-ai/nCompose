import { FigmaClient } from './src/figma/fetch.js';
import 'dotenv/config';

const client = new FigmaClient(process.env.FIGMA_TOKEN!);
const fileKey = 'rAim3nrWukuYQQRmYU1L8r';

async function compareStrokes() {
  const data = await client.getFile(fileKey);

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

  const rootNode = findNode(data.document, '8119:29710');

  // Check variants we know have borders
  const neutralDefault = rootNode.children.find((v: any) =>
    v.name.includes('Style=Neutral') && v.name.includes('State=Default') && v.name.includes('Size=Small')
  );

  const subtleFocus = rootNode.children.find((v: any) =>
    v.name.includes('Style=Subtle') && v.name.includes('State=Focus') && v.name.includes('Size=Small')
  );

  // Check variants we know DON'T have borders
  const subtleDefault = rootNode.children.find((v: any) =>
    v.name.includes('Style=Subtle') && v.name.includes('State=Default') && v.name.includes('Size=Small')
  );

  const subtleHover = rootNode.children.find((v: any) =>
    v.name.includes('Style=Subtle') && v.name.includes('State=Hover') && v.name.includes('Size=Small')
  );

  const neutralHover = rootNode.children.find((v: any) =>
    v.name.includes('Style=Neutral') && v.name.includes('State=Hover') && v.name.includes('Size=Small')
  );

  console.log('=== VARIANTS WITH VISIBLE BORDERS ===\n');

  console.log('Neutral/Default/Small (should have border):');
  console.log('  strokes array:', neutralDefault.strokes ? 'exists' : 'null/undefined');
  console.log('  strokes length:', neutralDefault.strokes?.length || 0);
  if (neutralDefault.strokes?.[0]) {
    console.log('  stroke.visible:', neutralDefault.strokes[0].visible);
    console.log('  stroke.type:', neutralDefault.strokes[0].type);
  }

  console.log('\nSubtle/Focus/Small (should have border):');
  console.log('  strokes array:', subtleFocus.strokes ? 'exists' : 'null/undefined');
  console.log('  strokes length:', subtleFocus.strokes?.length || 0);
  if (subtleFocus.strokes?.[0]) {
    console.log('  stroke.visible:', subtleFocus.strokes[0].visible);
    console.log('  stroke.type:', subtleFocus.strokes[0].type);
  }

  console.log('\n\n=== VARIANTS WITHOUT BORDERS ===\n');

  console.log('Subtle/Default/Small (should NOT have border):');
  console.log('  strokes array:', subtleDefault.strokes ? 'exists' : 'null/undefined');
  console.log('  strokes length:', subtleDefault.strokes?.length || 0);
  if (subtleDefault.strokes && subtleDefault.strokes.length > 0) {
    console.log('  strokes:', JSON.stringify(subtleDefault.strokes, null, 2));
  }

  console.log('\nSubtle/Hover/Small (should NOT have border):');
  console.log('  strokes array:', subtleHover.strokes ? 'exists' : 'null/undefined');
  console.log('  strokes length:', subtleHover.strokes?.length || 0);
  if (subtleHover.strokes && subtleHover.strokes.length > 0) {
    console.log('  strokes:', JSON.stringify(subtleHover.strokes, null, 2));
  }

  console.log('\n\n=== NEUTRAL HOVER (USER SAYS NO BORDER) ===\n');

  console.log('Neutral/Hover/Small (user says should NOT have border):');
  console.log('  strokes array:', neutralHover.strokes ? 'exists' : 'null/undefined');
  console.log('  strokes length:', neutralHover.strokes?.length || 0);
  if (neutralHover.strokes && neutralHover.strokes.length > 0) {
    console.log('  Full stroke data:', JSON.stringify(neutralHover.strokes, null, 2));
    console.log('  stroke.visible:', neutralHover.strokes[0].visible);
    console.log('  stroke.opacity:', neutralHover.strokes[0].opacity);
  }
}

compareStrokes().catch(console.error);
