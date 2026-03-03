import { validateBEMConsistency } from './bem-validate.js';
import { getExpectedElement, validateSemanticElement } from './semantic-validate.js';
import { validateTextFidelity } from './text-fidelity-validate.js';
import { validateLayoutFidelity } from './layout-fidelity-validate.js';
import { config } from '../config.js';

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

export interface BuildFidelityReportOptions {
  rawCode: string;
  css?: string;
  componentCategory?: string;
  expectedTextLiterals?: string[];
  includeLayoutCheck?: boolean;
}

export function buildFidelityReport(
  options: BuildFidelityReportOptions,
): FidelityReport {
  const {
    rawCode,
    css,
    componentCategory,
    expectedTextLiterals = [],
    includeLayoutCheck = false,
  } = options;

  const checks: FidelityReport['checks'] = {};

  if (componentCategory) {
    const expected = getExpectedElement(componentCategory);
    if (expected) {
      const result = validateSemanticElement(rawCode, expected);
      checks.semantic = { passed: result.passed, summary: result.summary || '' };
    }
  }

  if (css) {
    const bem = validateBEMConsistency(rawCode, css);
    checks.bem = { passed: bem.passed, summary: bem.summary || '' };
  }

  if (expectedTextLiterals.length > 0) {
    const text = validateTextFidelity(rawCode, expectedTextLiterals);
    checks.text = { passed: text.passed, summary: text.summary || '' };
  }

  if (includeLayoutCheck && css) {
    const layout = validateLayoutFidelity(rawCode, css, {
      minimumElementCoverage: config.fidelity.minLayoutCoverage,
      forbidInlineSizing: config.fidelity.forbidInlineSizing,
    });
    checks.layout = {
      passed: layout.passed,
      summary: layout.summary || '',
      coverage: layout.coverage,
      missingElementClasses: layout.missingElementClasses,
    };
  }

  const presentChecks = Object.values(checks);
  const overallPassed = presentChecks.every((c) => c.passed);

  return {
    generatedAt: new Date().toISOString(),
    checks,
    metrics: {
      expectedTextCount: expectedTextLiterals.length,
    },
    overallPassed,
  };
}
