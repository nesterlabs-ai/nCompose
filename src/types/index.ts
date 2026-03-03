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
