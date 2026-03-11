import 'dotenv/config';
import { FigmaClient } from './src/figma/fetch.js';
import { parseFigmaUrl } from './src/utils/figma-url-parser.js';

const url = 'https://www.figma.com/design/MgOxwvJAELcnhDCncMOKeH/Sqrx-Admin-Portal-Redesign?node-id=340-44870&m=dev';
const { fileKey, nodeId } = parseFigmaUrl(url);
const client = new FigmaClient(process.env.FIGMA_TOKEN!);
const resp = await client.getNode(fileKey, nodeId);
const node = (resp as any).nodes[nodeId]?.document;

function dumpTree(n: any, depth = 0, maxDepth = 6): void {
  if (!n || depth > maxDepth) return;
  const indent = '  '.repeat(depth);
  const bb = n.absoluteBoundingBox;
  const size = bb ? Math.round(bb.width) + 'x' + Math.round(bb.height) : '?';
  const text = n.type === 'TEXT' ? ' -> "' + (n.characters ?? '').substring(0, 50) + '"' : '';
  const vis = n.visible === false ? ' [HIDDEN]' : '';
  const layout = n.layoutMode ? ' layout:' + n.layoutMode : '';
  const fills = (() => {
    const solidFill = (n.fills ?? []).find((f: any) => f.type === 'SOLID' && f.color);
    if (solidFill) {
      const c = solidFill.color;
      return ' fill:#' + Math.round(c.r*255).toString(16).padStart(2,'0') + Math.round(c.g*255).toString(16).padStart(2,'0') + Math.round(c.b*255).toString(16).padStart(2,'0');
    }
    const gradFill = (n.fills ?? []).find((f: any) => f.type === 'GRADIENT_LINEAR');
    if (gradFill) return ' fill:GRADIENT';
    return '';
  })();
  const stroke = (n.strokes ?? []).length > 0 ? ' stroked' : '';
  const arc = n.arcData ? ' arc:' + Math.round(n.arcData.startingAngle*180/Math.PI) + '-' + Math.round(n.arcData.endingAngle*180/Math.PI) + ' ir:' + (n.arcData.innerRadius ?? 0) : '';
  console.log(indent + n.type + ' "' + n.name + '" ' + size + layout + vis + text + fills + stroke + arc);
  for (const c of n.children ?? []) dumpTree(c, depth + 1, maxDepth);
}
dumpTree(node);
