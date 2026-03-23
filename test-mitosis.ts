import { parseJsx, componentToReact } from '@builder.io/mitosis';

const code = `
export default function Chip() {
  return <div><span className="label">Hello</span></div>;
}
`;

const parsed = parseJsx(code);

const div = parsed.children[0];
const span = div.children[0];

// Test 1: properties
span.properties['data-ve-id'] = '1-2-3';

// Test 2: bindings (code)
if (!div.bindings) div.bindings = {};
div.bindings['data-ve-id'] = { code: "'0-1-2'" };

const reactCode = componentToReact({ stateType: 'useState' })({ component: parsed });
console.log(reactCode);
