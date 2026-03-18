import type { MitosisComponent } from '@builder.io/mitosis';

/**
 * A downloaded SVG/image asset exported from Figma.
 * Written to outputDir/assets/ and referenced as <img src="./assets/..."> in components.
 */
export interface AssetEntry {
  nodeId: string;
  nodeName: string;
  /** Deduplicated filename, e.g. "left-icon.svg", "vector-2.svg" */
  filename: string;
  /** Figma presigned SVG export URL */
  url: string;
  /** Downloaded SVG markup — undefined if download failed */
  content?: string;
}

/**
 * Supported output frameworks.
 */
export type Framework = 'react' | 'vue' | 'svelte' | 'angular' | 'solid';

export const SUPPORTED_FRAMEWORKS: Framework[] = ['react', 'vue', 'svelte', 'angular', 'solid'];

/**
 * Supported LLM providers.
 */
export type LLMProviderName = 'deepseek' | 'claude' | 'openai';

export const SUPPORTED_LLM_PROVIDERS: LLMProviderName[] = ['deepseek', 'claude', 'openai'];

/**
 * Result of parsing LLM output through Mitosis parseJsx().
 */
export interface ParseResult {
  success: boolean;
  component?: MitosisComponent;
  error?: string;
  rawCode: string;
  /** Extracted CSS from LLM output (PATH B class-based styling) */
  css?: string;
}

export interface FidelityCheck {
  passed: boolean;
  summary: string;
}

export interface FidelityReport {
  generatedAt: string;
  checks: {
    semantic?: FidelityCheck;
    bem?: FidelityCheck;
    text?: FidelityCheck;
    layout?: FidelityCheck & {
      coverage: number;
      missingElementClasses: string[];
    };
  };
  metrics: {
    expectedTextCount: number;
  };
  overallPassed: boolean;
}

/**
 * A standalone chart component generated from a Figma chart section.
 */
export interface ChartComponent {
  /** PascalCase component name, e.g. "InterestEarnedChart" */
  name: string;
  /** Complete React JSX source for the chart component file */
  reactCode: string;
  /** CSS for the chart component */
  css: string;
}

/**
 * A shadcn sub-component generated from a child node within a composite component.
 * Used when PATH B detects recognized shadcn primitives (button, input, etc.) inside
 * a composite component that itself is not a shadcn component.
 */
export interface ShadcnSubComponent {
  /** shadcn component name (e.g. "button", "input") */
  shadcnComponentName: string;
  /** LLM-customized shadcn component source (.tsx with CVA variants) */
  updatedShadcnSource: string;
}

/**
 * Output of the full pipeline for a single component.
 */
export interface ConversionResult {
  componentName: string;
  mitosisSource: string;
  frameworkOutputs: Record<Framework, string>;
  /** SVG/image assets to write to outputDir/assets/ */
  assets: AssetEntry[];
  /** Component property definitions from Figma (for preview app) */
  componentPropertyDefinitions?: Record<string, any>;
  /** Raw CSS (internal use for page composition) */
  css?: string;
  /** Variant axes metadata (for preview app) */
  variantMetadata?: {
    axes: Array<{ name: string; values: string[]; default: string }>;
    variants: Array<{ name: string; props: Record<string, string> }>;
  };
  /** Fidelity diagnostics report for this generation run */
  fidelityReport?: FidelityReport;
  /** Standalone chart components generated from chart sections */
  chartComponents?: ChartComponent[];
  /** LLM-customized shadcn component source (.tsx with CVA variants) */
  updatedShadcnSource?: string;
  /** shadcn component name (e.g. "button") */
  shadcnComponentName?: string;
  /** shadcn sub-components generated from child nodes in a composite component */
  shadcnSubComponents?: ShadcnSubComponent[];
}

/**
 * Parsed Figma URL parts.
 */
export interface FigmaUrlParts {
  fileKey: string;
  nodeId?: string;
}

/**
 * CLI options passed to the convert command.
 */
export interface ConvertOptions {
  frameworks: Framework[];
  output: string;
  name?: string;
  llm: LLMProviderName;
  depth: number;
  /** When true, prompts instruct the LLM to use Tailwind + cn() + CSS variables for the starter template. */
  templateMode?: boolean;
  figmaToken?: string; // Pass token directly instead of relying on process.env
}

/**
 * File extension mapping per framework.
 */
export const FRAMEWORK_EXTENSIONS: Record<Framework, string> = {
  react: '.jsx',
  vue: '.vue',
  svelte: '.svelte',
  angular: '.ts',
  solid: '.tsx',
};
