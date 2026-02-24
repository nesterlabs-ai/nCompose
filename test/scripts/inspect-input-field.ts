/**
 * Fetches the InputField component set from Figma and inspects the parsed data.
 */
import 'dotenv/config';
import { FigmaClient } from '../src/figma/fetch.js';
import { simplifyFigmaData } from '../src/figma/simplify.js';
import { enhanceSimplifiedDesign } from '../src/figma/enhance.js';
import { parseComponentSet, buildVariantCSS, classifyStateValue } from '../src/figma/component-set-parser.js';
import { buildVariantPromptData, buildComponentSetUserPrompt, buildComponentSetSystemPrompt } from '../src/figma/variant-prompt-builder.js';
import { dump } from 'js-yaml';
import { writeFileSync } from 'fs';

async function main() {
  const client = new FigmaClient(process.env.FIGMA_TOKEN!);
  const rawData = await client.getNode('rAim3nrWukuYQQRmYU1L8r', '3395:14507', 25);
  const simplified = simplifyFigmaData(rawData, { maxDepth: 25 });
  const enhanced = enhanceSimplifiedDesign(simplified);

  // Save debug YAML
  const yaml = dump(enhanced, { lineWidth: 120, noRefs: true });
  writeFileSync('./output2/debug-input-field.yaml', yaml);
  console.log('Saved debug YAML to output2/debug-input-field.yaml');

  const data = parseComponentSet(enhanced);
  if (!data) {
    console.error('Failed to parse');
    return;
  }

  console.log('\n=== Parsed Data ===');
  console.log('Name:', data.name);
  console.log('Axes:', data.axes.map(a => `${a.name}=[${a.values.join(', ')}]`).join(' | '));
  console.log('State axis:', data.stateAxis?.name, '→', data.stateAxis?.values);
  console.log('Prop axes:', data.propAxes.map(a => a.name));
  console.log('Boolean props:', data.booleanProps);

  console.log('\n=== Classified States ===');
  for (const cs of data.classifiedStates) {
    console.log(`  "${cs.originalValue}" → bool: ${cs.booleanCondition ?? 'null'}, css: "${cs.cssSelector}"`);
  }

  console.log('\n=== Default Variant ===');
  console.log('Props:', data.defaultVariant.props);
  console.log('Container styles:', data.defaultVariant.styles.container);
  console.log('Text styles:', data.defaultVariant.styles.text);

  console.log('\n=== Default Variant Node Children ===');
  if (data.defaultVariantNode?.children) {
    for (const child of data.defaultVariantNode.children) {
      console.log(`  ${child.name} (${child.type})${child.text ? ` text="${child.text}"` : ''}`);
      if (child.children) {
        for (const sub of child.children) {
          console.log(`    ${sub.name} (${sub.type})${sub.text ? ` text="${sub.text}"` : ''}`);
        }
      }
    }
  }

  console.log('\n=== Generated CSS ===');
  const css = buildVariantCSS(data);
  console.log(css);
  console.log(`\n(${css.split('\n').length} lines)`);

  console.log('\n=== Generated Prompt ===');
  const promptData = buildVariantPromptData(data);
  console.log('Element type:', promptData.elementType);
  console.log('Props:', promptData.props);
  console.log('Structure:\n', promptData.structure);

  const trimmedNode = { name: data.defaultVariantNode?.name, type: data.defaultVariantNode?.type, children: data.defaultVariantNode?.children?.map((c: any) => ({ name: c.name, type: c.type, text: c.text, children: c.children?.map((s: any) => ({ name: s.name, type: s.type, text: s.text })) })) };
  const defaultYaml = dump(trimmedNode, { lineWidth: 120, noRefs: true });
  const userPrompt = buildComponentSetUserPrompt(promptData, defaultYaml);
  console.log('\n=== User Prompt (first 60 lines) ===');
  console.log(userPrompt.split('\n').slice(0, 60).join('\n'));
}

main().catch(console.error);
