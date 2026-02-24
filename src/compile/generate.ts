import {
  componentToReact,
  componentToVue,
  componentToSvelte,
  componentToAngular,
  componentToSolid,
} from '@builder.io/mitosis';
import type { MitosisComponent } from '@builder.io/mitosis';
import type { Framework } from '../types/index.js';

/**
 * Pre-configured generators for each framework.
 *
 * Mitosis generators are curried: componentToX(options) returns a
 * transpiler function that takes { component } and returns code.
 */
const generators: Record<Framework, (component: MitosisComponent) => string> = {
  react: (c) =>
    componentToReact({
      stateType: 'useState',
      stylesType: 'style-tag',
    })({ component: c }),

  vue: (c) =>
    componentToVue({
      api: 'composition',
    })({ component: c }),

  svelte: (c) =>
    componentToSvelte({
      stateType: 'variables',
    })({ component: c }),

  angular: (c) =>
    componentToAngular({
      standalone: true,
    })({ component: c }),

  solid: (c) =>
    componentToSolid({
      stateType: 'store',
      stylesType: 'style-tag',
    })({ component: c }),
};

/**
 * Generates framework-specific code from a parsed MitosisComponent.
 *
 * @param component - The parsed Mitosis component (from parseJsx)
 * @param frameworks - Which frameworks to generate code for
 * @returns A record mapping each framework to its generated code string
 */
export function generateFrameworkCode(
  component: MitosisComponent,
  frameworks: Framework[],
): Record<string, string> {
  const results: Record<string, string> = {};

  for (const fw of frameworks) {
    try {
      results[fw] = generators[fw](component);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      results[fw] = `// Error generating ${fw} code: ${msg}`;
    }
  }

  return results;
}
