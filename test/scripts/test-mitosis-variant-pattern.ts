/**
 * Test: Can Mitosis parse and compile a component that uses
 * css={state.classes} with a useStore getter + style lookup table?
 */
import { parseJsx } from '@builder.io/mitosis';
import {
  componentToReact,
  componentToVue,
  componentToSvelte,
  componentToAngular,
  componentToSolid,
} from '@builder.io/mitosis';

const mitosisCode = `
import { useStore, useDefaultProps } from '@builder.io/mitosis';

export default function ButtonDanger(props) {
  useDefaultProps({
    variant: 'primary',
    size: 'medium',
    disabled: false,
    loading: false,
  });

  const state = useStore({
    get buttonStyles() {
      const base = {
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '8px',
        borderRadius: '8px',
        cursor: 'pointer',
        border: 'none',
      };

      const variants = {
        primary: { backgroundColor: '#F04E4C', boxShadow: '0px 1px 4px 0px rgba(12, 12, 13, 0.05), 0px 1px 4px 0px rgba(12, 12, 13, 0.1)' },
        neutral: { backgroundColor: 'rgba(255, 255, 255, 0.6)', border: '1.5px solid rgba(255, 255, 255, 0.4)', backdropFilter: 'blur(30px)' },
        subtle: { backgroundColor: 'transparent' },
      };

      const sizes = {
        medium: { padding: '8px 16px', height: '40px' },
        small: { padding: '8px 12px', height: '36px' },
      };

      return { ...base, ...variants[props.variant], ...sizes[props.size] };
    },

    get labelStyles() {
      const base = {
        fontFamily: 'Host Grotesk',
        fontWeight: '500',
        fontSize: '14px',
        lineHeight: '1em',
      };

      const colors = {
        primary: { color: '#FDE9E9' },
        neutral: { color: '#EC221F' },
        subtle: { color: '#EC221F' },
      };

      return { ...base, ...colors[props.variant] };
    },
  });

  return (
    <button css={state.buttonStyles} disabled={props.disabled || props.loading}>
      <span css={state.labelStyles}>{props.children || 'Button'}</span>
    </button>
  );
}
`;

console.log('=== Testing Mitosis with variant pattern ===\n');

// Step 1: Parse
try {
  const component = parseJsx(mitosisCode, { typescript: true });
  console.log('✓ parseJsx succeeded');
  console.log(`  Component name: ${component.name}`);
  console.log(`  State keys: ${Object.keys(component.state).join(', ')}`);

  // Step 2: Generate for each framework
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
      const code = typeof output === 'string' ? output : output?.code ?? output?.toString?.() ?? '';
      if (code && !code.startsWith('// Error')) {
        console.log(`✓ ${name}: generated (${code.split('\\n').length} lines)`);
        if (name === 'React') {
          console.log('\n--- React Output ---');
          console.log(code.substring(0, 1500));
          console.log('---\n');
        }
      } else {
        console.log(`✗ ${name}: empty or error output`);
      }
    } catch (err: any) {
      console.log(`✗ ${name}: ${err.message}`);
    }
  }
} catch (err: any) {
  console.log(`✗ parseJsx FAILED: ${err.message}`);
  console.log('\n  The variant pattern is NOT supported by Mitosis parseJsx.');
  console.log('  We need to use the direct code generation approach instead.');
}
