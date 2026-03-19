/**
 * shadcn/ui Component Type Mapping
 *
 * Maps formRole / ComponentCategory values to shadcn component names.
 * Button-only for now — expand as needed.
 */

/** Maps formRole → shadcn registry component name */
const FORM_ROLE_TO_SHADCN: Record<string, string> = {
  button: 'button',
  iconButton: 'button',
  textInput: 'input',
  textarea: 'textarea',
  search: 'input',
  chip: 'button',
  statusIndicator: 'badge',
  toast: 'toast',
  dialog: 'dialog',
  modal: 'dialog',
  checkbox: 'checkbox',
  radio: 'radio',
  toggle: 'switch',
  select: 'select',
  tab: 'tabs',
  avatar: 'avatar',
  tooltip: 'tooltip',
  slider: 'slider',
  pagination: 'pagination',
  stepper: 'stepper',
  breadcrumb: 'breadcrumb',
  calendar: 'calendar',
  dropdownMenu: 'dropdown-menu',
  form: 'form',
  card: 'card',
  progress: 'progress',
  progressBar: 'progress',
  sidebar: 'sidebar',
  table: 'table',
  dataTable: 'table',
};

/** Also map ComponentCategory values that differ from formRole */
const CATEGORY_TO_SHADCN: Record<string, string> = {
  button: 'button',
  'icon-button': 'button',
  input: 'input',
  textarea: 'textarea',
  search: 'input',
  chip: 'button',
  tag: 'badge',
  badge: 'badge',
  'status-indicator': 'badge',
  toast: 'toast',
  dialog: 'dialog',
  modal: 'dialog',
  checkbox: 'checkbox',
  radio: 'radio',
  'radio-button': 'radio',
  toggle: 'switch',
  switch: 'switch',
  select: 'select',
  dropdown: 'select',
  'dropdown-field': 'select',
  tab: 'tabs',
  tabs: 'tabs',
  avatar: 'avatar',
  tooltip: 'tooltip',
  slider: 'slider',
  range: 'slider',
  pagination: 'pagination',
  stepper: 'stepper',
  'step-indicator': 'stepper',
  breadcrumb: 'breadcrumb',
  calendar: 'calendar',
  'date-picker': 'calendar',
  'dropdown-menu': 'dropdown-menu',
  'context-menu': 'dropdown-menu',
  'popover-menu': 'dropdown-menu',
  form: 'form',
  'form-field': 'form',
  'form-group': 'form',
  card: 'card',
  progress: 'progress',
  'progress-bar': 'progress',
  sidebar: 'sidebar',
  'side-bar': 'sidebar',
  'nav-bar': 'sidebar',
  'navigation': 'sidebar',
  table: 'table',
  'data-table': 'table',
  'data-grid': 'table',
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
