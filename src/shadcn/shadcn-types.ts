/**
 * shadcn/ui Component Type Mapping
 *
 * Maps formRole / ComponentCategory values to shadcn component names.
 * Button-only for now — expand as needed.
 */

/** Maps formRole → shadcn registry component name */
const FORM_ROLE_TO_SHADCN: Record<string, string> = {
  button: 'button',
  textInput: 'input',
};

/** Also map ComponentCategory values that differ from formRole */
const CATEGORY_TO_SHADCN: Record<string, string> = {
  button: 'button',
  'icon-button': 'button',
  input: 'input',
  textarea: 'input',
};

const SUPPORTED = new Set([
  ...Object.keys(FORM_ROLE_TO_SHADCN),
  ...Object.keys(CATEGORY_TO_SHADCN),
]);

/**
 * Check if a formRole or category maps to a shadcn component.
 */
export function isShadcnSupported(formRoleOrCategory: string): boolean {
  return SUPPORTED.has(formRoleOrCategory);
}

/**
 * Get the shadcn component name for a given formRole or category.
 * Returns undefined if not supported.
 */
export function getShadcnComponentType(formRoleOrCategory: string): string | undefined {
  return FORM_ROLE_TO_SHADCN[formRoleOrCategory] ?? CATEGORY_TO_SHADCN[formRoleOrCategory];
}

/**
 * Result from shadcn LLM codegen.
 */
export interface ShadcnCodegenResult {
  /** Consumer component JSX (imports from @/components/ui/xxx) */
  consumerCode: string;
  /** Updated shadcn component source (.tsx with CVA variants) */
  updatedShadcnSource: string;
  /** shadcn component name (e.g. "button") */
  shadcnComponentName: string;
  /** Component name for the consumer (e.g. "Buttondanger") */
  componentName: string;
}
