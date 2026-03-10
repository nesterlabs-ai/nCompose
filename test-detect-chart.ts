import 'dotenv/config';
import { FigmaClient } from './src/figma/fetch.js';
import { parseFigmaUrl } from './src/utils/figma-url-parser.js';
import { isChartSection } from './src/figma/chart-detection.js';

const URL =
  'https://www.figma.com/design/M46FYTFlAJJEgxC3j7phKV/%E2%9D%96-Untitled-UI-%E2%80%93-FREE-Figma-UI-kit-and-design-system-v2.0--Community-?node-id=1084-2347&m=dev';

function figmaColor(c: any): string {
  if (!c) return '';
  const r = Math.round((c.r ?? 0) * 255);
  const g = Math.round((c.g ?? 0) * 255);
  const b = Math.round((c.b ?? 0) * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function walkTree(node: any, depth = 0, maxDepth = 10): string {
  if (!node || depth > maxDepth) return '';
  if (node.visible === false) return '';
  const indent = '  '.repeat(depth);
  const name = node.name ?? '?';
  const type = node.type ?? '?';
  const bb = node.absoluteBoundingBox;
  const size = bb ? ` ${Math.round(bb.width)}×${Math.round(bb.height)}` : '';
  const fills = (node.fills ?? [])
    .filter((f: any) => f.visible !== false)
    .map((f: any) => {
      if (f.type === 'SOLID' && f.color) return figmaColor(f.color);
      if (f.type?.startsWith('GRADIENT')) return f.type;
      return f.type ?? '';
    }).filter(Boolean);
  const fillStr = fills.length > 0 ? ` [${fills.join(', ')}]` : '';
  const text = type === 'TEXT' ? ` "${(node.characters ?? '').substring(0, 50)}"` : '';
  const chart = isChartSection(node) ? ' ⬅ CHART' : '';
  const layout = node.layoutMode ? ` layout=${node.layoutMode}` : '';
  const gap = node.itemSpacing ? ` gap=${node.itemSpacing}` : '';

  let line = `${indent}${type} "${name}"${size}${text}${fillStr}${layout}${gap}${chart}\n`;
  for (const child of (node.children ?? []).slice(0, 30)) {
    line += walkTree(child, depth + 1, maxDepth);
  }
  return line;
}

function getSolidFill(node: any): string | null {
  const fills = (node.fills ?? []).filter((f: any) => f.visible !== false);
  const solid = fills.find((f: any) => f.type === 'SOLID' && f.color);
  return solid ? figmaColor(solid.color) : null;
}

async function main() {
  const token = process.env.FIGMA_TOKEN!;
  const { fileKey, nodeId } = parseFigmaUrl(URL);
  const client = new FigmaClient(token);

  const data = await client.getNode(fileKey, nodeId!);
  const node = data.nodes?.[nodeId!]?.document;
  if (!node) { console.log('Not found'); return; }

  console.log('FULL NODE TREE:\n');
  console.log(walkTree(node, 0, 10));

  console.log('\n=== DETECTION ===\n');
  console.log(`isChartSection(root): ${isChartSection(node)}`);
  if (node.children) {
    for (const child of node.children) {
      if (isChartSection(child)) console.log(`  Child "${child.name}" → CHART ✓`);
    }
  }

  // Collect all nodes
  const allNodes: any[] = [];
  const typeCounts: Record<string, number> = {};
  function collect(n: any) {
    if (!n || n.visible === false) return;
    typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
    allNodes.push(n);
    for (const c of n.children ?? []) collect(c);
  }
  collect(node);

  console.log('\nNode types:', typeCounts);

  const ellipses = allNodes.filter((n) => n.type === 'ELLIPSE');
  const rects = allNodes.filter((n) => n.type === 'RECTANGLE');
  const vectors = allNodes.filter((n) => n.type === 'VECTOR');
  const texts = allNodes.filter((n) => n.type === 'TEXT');

  console.log(`\nELLIPSEs: ${ellipses.length}`);
  for (const e of ellipses) {
    const bb = e.absoluteBoundingBox;
    console.log(`  "${e.name}" ${bb?.width}×${bb?.height} ${getSolidFill(e) ?? ''}`);
  }

  console.log(`\nRECTANGLEs: ${rects.length}`);
  for (const r of rects.slice(0, 20)) {
    const bb = r.absoluteBoundingBox;
    console.log(`  "${r.name}" ${bb?.width}×${bb?.height} ${getSolidFill(r) ?? ''}`);
  }

  console.log(`\nVECTORs: ${vectors.length}`);
  for (const v of vectors.slice(0, 15)) {
    const bb = v.absoluteBoundingBox;
    console.log(`  "${v.name}" ${bb?.width}×${bb?.height} ${getSolidFill(v) ?? ''}`);
  }

  console.log(`\nTEXT nodes: ${texts.length}`);
  for (const t of texts) {
    console.log(`  "${t.characters?.substring(0, 50)}" (${t.style?.fontSize ?? '?'}px)`);
  }

  // Overlap analysis
  console.log('\n--- Overlap analysis ---');
  if (ellipses.length >= 2) {
    const bbs = ellipses.map((e) => e.absoluteBoundingBox).filter(Boolean);
    const overlapping = bbs.filter((a: any, i: number) =>
      bbs.some((b: any, j: number) =>
        i !== j &&
        Math.abs(a.x - b.x) < 5 &&
        Math.abs(a.y - b.y) < 5 &&
        Math.abs(a.width - b.width) < 5,
      ),
    );
    if (overlapping.length >= 2) {
      console.log(`⚡ ${overlapping.length} overlapping ellipses → DONUT/PIE signal`);
    } else {
      console.log('No overlapping ellipses');
    }
  }

  if (rects.length >= 3) {
    const rBBs = rects.map((r) => r.absoluteBoundingBox).filter(Boolean);
    // Vertical bars: shared bottom
    const bottoms = rBBs.map((bb: any) => Math.round(bb.y + bb.height));
    const bottomGroups = new Map<number, number>();
    for (const b of bottoms) {
      let found = false;
      for (const [k, v] of bottomGroups) {
        if (Math.abs(k - b) <= 3) { bottomGroups.set(k, v + 1); found = true; break; }
      }
      if (!found) bottomGroups.set(b, 1);
    }
    const barGroups = [...bottomGroups.entries()].filter(([, c]) => c >= 3);
    if (barGroups.length > 0) {
      for (const [baseline, count] of barGroups) {
        console.log(`⚡ ${count} rects share bottom baseline y≈${baseline} → VERTICAL BAR signal`);
      }
    }

    // Horizontal bars: shared left edge
    const lefts = rBBs.map((bb: any) => Math.round(bb.x));
    const leftGroups = new Map<number, number>();
    for (const l of lefts) {
      let found = false;
      for (const [k, v] of leftGroups) {
        if (Math.abs(k - l) <= 3) { leftGroups.set(k, v + 1); found = true; break; }
      }
      if (!found) leftGroups.set(l, 1);
    }
    const hBarGroups = [...leftGroups.entries()].filter(([, c]) => c >= 3);
    if (hBarGroups.length > 0) {
      for (const [leftEdge, count] of hBarGroups) {
        console.log(`⚡ ${count} rects share left edge x≈${leftEdge} → HORIZONTAL BAR signal`);
        const bars = rects.filter((r) => {
          const bb = r.absoluteBoundingBox;
          return bb && Math.abs(Math.round(bb.x) - leftEdge) <= 3;
        });
        console.log(`  Widths: [${bars.map((b) => Math.round(b.absoluteBoundingBox.width)).join(', ')}]`);
        console.log(`  Heights: [${bars.map((b) => Math.round(b.absoluteBoundingBox.height)).join(', ')}]`);
        console.log(`  Colors: [${bars.map((b) => getSolidFill(b) ?? '?').join(', ')}]`);
      }
    }
  }
}

main().catch(console.error);
