/**
 * Test: Can Mitosis handle class={state.x} binding with a <style> tag?
 * This would let us keep Mitosis for structure while handling CSS separately.
 */
import { parseJsx } from '@builder.io/mitosis';
import {
  componentToReact,
  componentToVue,
  componentToSvelte,
  componentToAngular,
  componentToSolid,
} from '@builder.io/mitosis';

// Pattern 1: class binding with useStore getter
const mitosisCode = `
import { useStore } from '@builder.io/mitosis';

export default function ButtonDanger(props) {
  const state = useStore({
    get classes() {
      const base = 'button-danger';
      return base + ' ' + base + '--' + (props.variant || 'primary') + ' ' + base + '--' + (props.size || 'medium');
    }
  });

  return (
    <button class={state.classes} disabled={props.disabled}>
      <span class="button-danger__label">{props.children || 'Button'}</span>
    </button>
  );
}
`;

console.log('=== Test: class={state.classes} binding ===\n');

try {
  const component = parseJsx(mitosisCode, { typescript: true });
  console.log('✓ parseJsx succeeded');

  const generators = [
    ['React', componentToReact({ stateType: 'useState', stylesType: 'style-tag' })],
    ['Vue', componentToVue({ api: 'composition' })],
    ['Svelte', componentToSvelte()],
    ['Angular', componentToAngular({ standalone: true })],
    ['Solid', componentToSolid({ stateType: 'store', stylesType: 'style-tag' })],
  ] as const;

  for (const [name, generator] of generators) {
    try {
      const output = (generator as any)({ component });
      const code = typeof output === 'string' ? output : output?.code ?? '';
      if (code && code.length > 10) {
        const lineCount = code.split('\n').length;
        console.log(`✓ ${name}: ${lineCount} lines`);
        // Show first 30 lines
        console.log(`\n--- ${name} ---`);
        console.log(code.split('\n').slice(0, 30).join('\n'));
        console.log('---\n');
      } else {
        console.log(`✗ ${name}: empty output`);
      }
    } catch (err: any) {
      console.log(`✗ ${name}: ${err.message}`);
    }
  }
} catch (err: any) {
  console.log(`✗ parseJsx FAILED: ${err.message}`);
}
