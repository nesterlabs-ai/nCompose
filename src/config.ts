/**
 * Centralized configuration — single source of truth for all hardcoded values.
 *
 * Every value has a sensible default and can be overridden via environment variable.
 * API keys are NOT included here (they're secrets, not configuration constants).
 */

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envFloat(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envStr(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

// ── LLM providers ──────────────────────────────────────────────────────────

export interface ClaudeConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  contextWindow: number;
}

export interface OpenAIConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  contextWindow: number;
}

export interface DeepSeekConfig {
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
  contextWindow: number;
}

// ── Figma ──────────────────────────────────────────────────────────────────

export interface FigmaConfig {
  apiBase: string;
  maxIconSize: number;
  preserveHiddenNodes: boolean;
  adjustSvgViewBox: boolean;
}

// ── Generation pipeline ────────────────────────────────────────────────────

export interface GenerationConfig {
  maxRetries: number;
  strictValidation: boolean;
}

// ── CSS generation ─────────────────────────────────────────────────────────

export interface CSSConfig {
  preserveExactDimensions: boolean;
  injectBehavioralStyles: boolean;
}

// ── Fidelity validation ────────────────────────────────────────────────────

export interface FidelityConfig {
  minLayoutCoverage: number;
  forbidInlineSizing: boolean;
  requireReportPass: boolean;
  /** Minimum fraction of expected YAML CSS values that must appear in generated CSS (0-1) */
  minCSSCoverage: number;
}

// ── Server (web UI) ────────────────────────────────────────────────────────

export interface ServerConfig {
  port: number;
  jsonLimit: string;
  outputDir: string;
  defaultLLM: string;
  defaultDepth: number;
}

// ── CLI ────────────────────────────────────────────────────────────────────

export interface CLIConfig {
  defaultLLM: string;
  defaultOutput: string;
  defaultDepth: string;
  defaultFrameworks: string;
}

// ── Page detection (PATH C) ───────────────────────────────────────────────

export interface PageConfig {
  /** Minimum number of sizeable child frames to trigger PATH C */
  minSections: number;
  /** Child must be at least this fraction of parent width to count */
  minChildWidthRatio: number;
  /** Child must be at least this tall (px) to count */
  minChildHeight: number;
}

// ── DynamoDB ─────────────────────────────────────────────────────────────

export interface DynamoConfig {
  tableName: string;
  region: string;
  endpoint: string;
}

// ── Cognito Auth ──────────────────────────────────────────────────────────

export interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  region: string;
}

// ── Free Tier ─────────────────────────────────────────────────────────────

export interface FreeTierConfig {
  maxFreeConversions: number;
  maxAuthConversions: number;
}

// ── Preview ────────────────────────────────────────────────────────────────

export interface PreviewConfig {
  port: number;
  /** 'raw' — always single render, 'grid' — always all-variants grid, 'auto' — grid when component set has multiple variants */
  mode: 'raw' | 'grid' | 'auto';
  cdnUrls: {
    react: string;
    reactDom: string;
    babel: string;
  };
}

// ── Top-level config object ────────────────────────────────────────────────

export const config = {
  llm: {
    claude: {
      model: envStr('CLAUDE_MODEL', 'claude-sonnet-4-20250514'),
      temperature: envFloat('CLAUDE_TEMPERATURE', 0.1),
      maxTokens: envInt('CLAUDE_MAX_TOKENS', 8192),
      contextWindow: envInt('CLAUDE_CONTEXT_WINDOW', 200000),
    } as ClaudeConfig,

    openai: {
      model: envStr('OPENAI_MODEL', 'gpt-4o'),
      temperature: envFloat('OPENAI_TEMPERATURE', 0.1),
      maxTokens: envInt('OPENAI_MAX_TOKENS', 16384),
      contextWindow: envInt('OPENAI_CONTEXT_WINDOW', 131072),
    } as OpenAIConfig,

    deepseek: {
      baseURL: envStr('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
      model: envStr('DEEPSEEK_MODEL', 'deepseek-chat'),
      temperature: envFloat('DEEPSEEK_TEMPERATURE', 0.1),
      maxTokens: envInt('DEEPSEEK_MAX_TOKENS', 8192),
      contextWindow: envInt('DEEPSEEK_CONTEXT_WINDOW', 131072),
    } as DeepSeekConfig,
  },

  figma: {
    apiBase: envStr('FIGMA_API_BASE', 'https://api.figma.com/v1'),
    maxIconSize: envInt('FIGMA_MAX_ICON_SIZE', 128),
    preserveHiddenNodes: envBool('FIGMA_PRESERVE_HIDDEN_NODES', true),
    adjustSvgViewBox: envBool('FIGMA_ADJUST_SVG_VIEWBOX', false),
  } as FigmaConfig,

  generation: {
    maxRetries: envInt('MAX_RETRIES', 3),
    strictValidation: envBool('STRICT_VALIDATION', true),
  } as GenerationConfig,

  css: {
    preserveExactDimensions: envBool('CSS_PRESERVE_EXACT_DIMENSIONS', true),
    injectBehavioralStyles: envBool('CSS_INJECT_BEHAVIORAL_STYLES', true),
  } as CSSConfig,

  fidelity: {
    minLayoutCoverage: envFloat('FIDELITY_MIN_LAYOUT_COVERAGE', 0.9),
    forbidInlineSizing: envBool('FIDELITY_FORBID_INLINE_SIZING', true),
    requireReportPass: envBool('FIDELITY_REQUIRE_REPORT_PASS', false),
    minCSSCoverage: envFloat('FIDELITY_MIN_CSS_COVERAGE', 0.5),
  } as FidelityConfig,

  server: {
    port: envInt('PORT', 3000),
    jsonLimit: envStr('SERVER_JSON_LIMIT', '1mb'),
    outputDir: envStr('SERVER_OUTPUT_DIR', './web_output'),
    defaultLLM: envStr('SERVER_DEFAULT_LLM', 'deepseek'),
    defaultDepth: envInt('SERVER_DEFAULT_DEPTH', 25),
  } as ServerConfig,

  cli: {
    defaultLLM: envStr('CLI_DEFAULT_LLM', 'deepseek'),
    defaultOutput: envStr('CLI_DEFAULT_OUTPUT', './output'),
    defaultDepth: envStr('CLI_DEFAULT_DEPTH', '25'),
    defaultFrameworks: envStr('CLI_DEFAULT_FRAMEWORKS', 'react'),
  } as CLIConfig,

  page: {
    minSections: envInt('PAGE_MIN_SECTIONS', 2),
    minChildWidthRatio: envFloat('PAGE_MIN_CHILD_WIDTH_RATIO', 0.5),
    minChildHeight: envInt('PAGE_MIN_CHILD_HEIGHT', 60),
  } as PageConfig,

  dynamo: {
    tableName: envStr('DYNAMODB_TABLE_NAME', ''),
    region: envStr('DYNAMODB_REGION', 'us-west-2'),
    endpoint: envStr('DYNAMODB_ENDPOINT', ''),
  } as DynamoConfig,

  cognito: {
    userPoolId: envStr('COGNITO_USER_POOL_ID', ''),
    clientId: envStr('COGNITO_CLIENT_ID', ''),
    region: envStr('COGNITO_REGION', 'us-west-2'),
  } as CognitoConfig,

  freeTier: {
    maxFreeConversions: envInt('FREE_TIER_MAX_CONVERSIONS', 5),
    maxAuthConversions: envInt('AUTH_MAX_CONVERSIONS', 20),
  } as FreeTierConfig,

  preview: {
    port: envInt('PREVIEW_PORT', 5173),
    mode: (() => {
      const m = envStr('PREVIEW_MODE', 'auto');
      if (m === 'grid') return 'grid';
      if (m === 'raw') return 'raw';
      return 'auto';
    })(),
    cdnUrls: {
      react: envStr('PREVIEW_CDN_REACT', 'https://unpkg.com/react@18/umd/react.development.js'),
      reactDom: envStr('PREVIEW_CDN_REACT_DOM', 'https://unpkg.com/react-dom@18/umd/react-dom.development.js'),
      babel: envStr('PREVIEW_CDN_BABEL', 'https://unpkg.com/@babel/standalone/babel.min.js'),
    },
  } as PreviewConfig,
};
