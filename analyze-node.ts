import 'dotenv/config';
import { FigmaClient } from './src/figma/fetch.js';
import { parseFigmaUrl } from './src/utils/figma-url-parser.js';
import { isChartSection, detectChartType, extractChartMetadata, _debugHasDataShapeCluster } from './src/figma/chart-detection.js';
import { generateChartCode } from './src/compile/chart-codegen.js';

const url = 'https://www.figma.com/design/MgOxwvJAELcnhDCncMOKeH/Sqrx-Admin-Portal-Redesign?node-id=340-46823&m=dev';
const { fileKey, nodeId } = parseFigmaUrl(url);

const token = process.env.FIGMA_TOKEN;
if (!token || !nodeId) { console.error('Missing'); process.exit(1); }

const client = new FigmaClient(token);
const resp = await client.getNode(fileKey, nodeId);
const node = (resp as any).nodes[nodeId]?.document;

function findAll(n: any, pred: (n: any) => boolean): any[] {
  const r: any[] = [];
  if (!n) return r;
  if (pred(n)) r.push(n);
  for (const c of n.children ?? []) r.push(...findAll(c, pred));
  return r;
}

function toHex(color: any): string {
  if (!color) return '?';
  return `#${Math.round(color.r*255).toString(16).padStart(2,'0')}${Math.round(color.g*255).toString(16).padStart(2,'0')}${Math.round(color.b*255).toString(16).padStart(2,'0')}`;
}

// ── 1. NODE OVERVIEW ──
const bb = node.absoluteBoundingBox;
console.log('=== 1. NODE OVERVIEW ===\n');
console.log(`  Type: ${node.type} | Name: "${node.name}"`);
console.log(`  Size: ${Math.round(bb.width)}x${Math.round(bb.height)} | Layout: ${node.layoutMode} | Spacing: ${node.itemSpacing}px`);
console.log(`  Padding: T${node.paddingTop} R${node.paddingRight} B${node.paddingBottom} L${node.paddingLeft}`);
console.log(`  Children: ${(node.children ?? []).length}`);

// ── 2. TREE STRUCTURE ──
console.log('\n=== 2. TREE STRUCTURE ===\n');
function dumpTree(n: any, depth = 0, maxDepth = 3): void {
  if (!n || depth > maxDepth) return;
  const indent = '  '.repeat(depth + 1);
  const nbb = n.absoluteBoundingBox;
  const size = nbb ? `${Math.round(nbb.width)}x${Math.round(nbb.height)}` : '?';
  const text = n.type === 'TEXT' ? ` → "${n.characters}"` : '';
  const vis = n.visible === false ? ' [HIDDEN]' : '';
  const layout = n.layoutMode ? ` layout:${n.layoutMode}` : '';
  console.log(`${indent}${n.type} "${n.name}" ${size}${layout}${vis}${text}`);
  for (const c of n.children ?? []) dumpTree(c, depth + 1, maxDepth);
}
dumpTree(node, 0, 4);

// ── 3. STRUCTURAL SIGNALS ──
console.log('\n=== 3. STRUCTURAL SIGNALS ===\n');

const allEllipses = findAll(node, (n: any) => n.type === 'ELLIPSE');
const large = allEllipses.filter((e: any) => (e.absoluteBoundingBox?.width ?? 0) >= 50);
const visible = large.filter((e: any) => e.visible !== false);
const hidden = large.filter((e: any) => e.visible === false);

console.log(`  Total ellipses: ${allEllipses.length} (${large.length} large, ${allEllipses.length - large.length} small)`);
console.log(`  Visible large: ${visible.length} | Hidden large: ${hidden.length}`);

// Center overlap
if (large.length > 0) {
  const ref = large[0].absoluteBoundingBox;
  const cx = Math.round(ref.x + ref.width / 2);
  const cy = Math.round(ref.y + ref.height / 2);
  const allSameCenter = large.every((e: any) => {
    const ebb = e.absoluteBoundingBox;
    return Math.abs(Math.round(ebb.x + ebb.width / 2) - cx) < 5 && Math.abs(Math.round(ebb.y + ebb.height / 2) - cy) < 5;
  });
  const allSameSize = large.every((e: any) => {
    const ebb = e.absoluteBoundingBox;
    return Math.abs(Math.round(ebb.width) - Math.round(ref.width)) < 5;
  });
  console.log(`  Same center: ${allSameCenter} | Same size: ${allSameSize} (${Math.round(ref.width)}x${Math.round(ref.height)})`);
}

// ── 4. VISIBLE SLICES ──
console.log('\n=== 4. VISIBLE SLICES ===\n');
for (const e of visible) {
  const solidFill = (e.fills ?? []).find((f: any) => f.type === 'SOLID');
  const hasGrad = (e.fills ?? []).some((f: any) => f.type === 'GRADIENT_RADIAL' || f.type === 'GRADIENT_LINEAR');
  const sweep = (e.arcData?.endingAngle ?? 0) - (e.arcData?.startingAngle ?? 0);
  const sweepNorm = sweep < 0 ? sweep + 2 * Math.PI : sweep;
  console.log(`  ${e.name}: color=${toHex(solidFill?.color)} | arc=${Math.round(sweepNorm * 180 / Math.PI)}° (${Math.round(sweepNorm / (2 * Math.PI) * 100)}%) | innerRadius=${e.arcData?.innerRadius} | gradient=${hasGrad}`);
}

// ── 5. DONUT vs PIE DETERMINATION ──
console.log('\n=== 5. DONUT vs PIE DETERMINATION ===\n');

// Signal 1: visible innerRadius
const visWithIR = visible.filter((e: any) => e.arcData?.innerRadius > 0);
console.log(`  Signal 1 (visible arcData.innerRadius > 0): ${visWithIR.length > 0 ? 'YES → donut' : 'NO'}`);

// Signal 2: visible center element
const groupBB = large[0]?.absoluteBoundingBox;
if (groupBB) {
  const gcx = groupBB.x + groupBB.width / 2;
  const gcy = groupBB.y + groupBB.height / 2;
  const gs = Math.max(groupBB.width, groupBB.height);
  const centerEls = findAll(node, (n: any) => {
    if (large.includes(n) || n.visible === false) return false;
    const nbb = n.absoluteBoundingBox;
    if (!nbb) return false;
    return Math.abs(nbb.x + nbb.width / 2 - gcx) < gs * 0.3 && Math.abs(nbb.y + nbb.height / 2 - gcy) < gs * 0.3 && nbb.width < gs * 0.6;
  });
  console.log(`  Signal 2 (visible center element): ${centerEls.length > 0 ? 'YES → donut' : 'NO'}`);
}

// Signal 3: partial arcs + gradient
const partials = visible.filter((e: any) => e.arcData && (e.arcData.startingAngle !== 0 || Math.abs(e.arcData.endingAngle - 2 * Math.PI) > 0.01));
const hasGrad = visible.some((e: any) => (e.fills ?? []).some((f: any) => f.type === 'GRADIENT_RADIAL' || f.type === 'GRADIENT_LINEAR'));
console.log(`  Signal 3 (partial arcs ${partials.length}/${visible.length} + gradient=${hasGrad}): ${partials.length > visible.length * 0.5 && hasGrad ? 'YES → donut' : 'NO'}`);

// ── 6. LEGEND ITEMS ──
console.log('\n=== 6. LEGEND ITEMS ===\n');
const legendFrame = node.children?.find((c: any) => {
  const texts = findAll(c, (n: any) => n.type === 'TEXT' && n.visible !== false);
  return texts.length >= 2 && c.type === 'FRAME' && c !== node.children?.[0];
});
if (legendFrame) {
  const items = findAll(legendFrame, (n: any) => {
    if (n.type !== 'FRAME' && n.type !== 'GROUP') return false;
    const dc = n.children ?? [];
    return dc.some((c: any) => c.type === 'TEXT') && dc.some((c: any) => c.type === 'ELLIPSE' && (c.absoluteBoundingBox?.width ?? 0) <= 16);
  });
  for (const item of items) {
    const text = (item.children ?? []).find((c: any) => c.type === 'TEXT');
    const dot = (item.children ?? []).find((c: any) => c.type === 'ELLIPSE');
    const dotFill = dot ? (dot.fills ?? []).find((f: any) => f.type === 'SOLID') : null;
    const vis = item.visible === false ? ' [HIDDEN]' : '';
    console.log(`  ${toHex(dotFill?.color)} "${text?.characters}"${vis}`);
  }
}

// ── 7. DETECTION RESULT ──
console.log('\n=== 7. DETECTION RESULT ===\n');
console.log(`  isChartSection(root): ${isChartSection(node)}`);
console.log(`  detectChartType: ${detectChartType(node)}`);
for (const child of node.children ?? []) {
  const isChart = isChartSection(child);
  console.log(`  child "${child.name}" → isChartSection: ${isChart}`);
  if (!isChart) {
    // Debug: show ellipse fills for non-chart children
    const childEllipses = findAll(child, (n: any) => n.type === 'ELLIPSE');
    console.log(`    ellipses: ${childEllipses.length}`);
    for (const e of childEllipses.slice(0, 8)) {
      const vis = e.visible === false ? '[HIDDEN]' : '';
      const fills = (e.fills ?? []).map((f: any) => f.type + (f.color ? ':' + toHex(f.color) : '')).join(', ');
      const sz = e.absoluteBoundingBox ? Math.round(e.absoluteBoundingBox.width) : '?';
      console.log(`      ${e.name} ${sz}px ${vis} fills=[${fills}]`);
    }
    // Check multi-chart guard
    const grandchildren = child.children ?? [];
    let chartGC = 0;
    for (const gc of grandchildren) {
      const gcE = findAll(gc, (n: any) => n.type === 'ELLIPSE');
      const large = gcE.filter((e: any) => (e.absoluteBoundingBox?.width ?? 0) >= 50);
      console.log(`    gc "${gc.name}" (${gc.type}): ${gcE.length} ellipses (${large.length} large)`);
      if (large.length >= 2) chartGC++;
    }
    console.log(`    chartGrandchildren: ${chartGC} (guard triggers if >= 2)`);
    // Direct signal A test
    const sigA = _debugHasDataShapeCluster(child);
    console.log(`    signalA direct: detected=${sigA.detected} highConf=${sigA.highConfidence}`);
    // Check guard result
    for (const gc of grandchildren) {
      if (gc.type === 'FRAME' || gc.type === 'GROUP' || gc.type === 'INSTANCE') {
        const gcSigA = _debugHasDataShapeCluster(gc);
        if (gcSigA.detected) console.log(`    guard: "${gc.name}" → detected`);
      }
    }
  }
}

// ── 8. EXTRACTED METADATA ──
const meta = await extractChartMetadata(node);
console.log('\n=== 8. EXTRACTED METADATA ===\n');
console.log(`  componentName: ${meta.componentName}`);
console.log(`  chartType: ${meta.chartType}`);
console.log(`  chartTitle: "${meta.chartTitle}"`);
console.log(`  size: ${meta.width}x${meta.height}`);
console.log(`  chartAreaHeight: ${meta.chartAreaHeight}`);
console.log(`  innerRadiusRatio: ${meta.innerRadiusRatio}`);
console.log(`  padding: T${meta.containerPadding.top} R${meta.containerPadding.right} B${meta.containerPadding.bottom} L${meta.containerPadding.left}`);
console.log(`  series: ${meta.series.length} items`);
for (const s of meta.series) {
  console.log(`    • "${s.name}" → color: ${s.color} | legendColor: ${s.legendColor} | value: ${s.value}`);
}
if (meta.rings.length > 0) {
  console.log(`  rings: ${meta.rings.length} items`);
  for (const r of meta.rings) {
    console.log(`    ◎ "${r.name}" → color: ${r.color} | track: ${r.trackColor} | progress: ${r.progress}% | radii: ${r.innerRadius}-${r.outerRadius}`);
  }
}
if (meta.donutCenterText) {
  console.log(`  centerText: "${meta.donutCenterText}" (${meta.donutCenterFontSize}px, wt:${meta.donutCenterFontWeight}, ${meta.donutCenterColor})`);
}
if (meta.centerSubtext) {
  console.log(`  centerSubtext: "${meta.centerSubtext}" (${meta.centerSubtextFontSize}px, wt:${meta.centerSubtextFontWeight}, ${meta.centerSubtextColor})`);
}

// ── 9. GENERATED CODE ──
const { reactCode, css } = generateChartCode(meta);
console.log('\n=== 9. GENERATED REACT CODE ===\n');
console.log(reactCode);
console.log('\n=== 9. GENERATED CSS ===\n');
console.log(css);
