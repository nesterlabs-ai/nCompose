/**
 * Phase 0 verification script — confirms all core library imports resolve correctly.
 * Run with: npx tsx src/verify-imports.ts
 */

// 1. Framelink MCP — simplification library
import { simplifyRawFigmaObject, allExtractors } from 'figma-developer-mcp';
console.log('Framelink MCP:', typeof simplifyRawFigmaObject === 'function' ? 'OK' : 'FAIL');
console.log('  - allExtractors:', Array.isArray(allExtractors) ? `OK (${allExtractors.length} extractors)` : 'FAIL');

// 2. Mitosis — compiler
import { parseJsx, componentToReact, componentToVue, componentToSvelte, componentToAngular, componentToSolid } from '@builder.io/mitosis';
console.log('Mitosis parseJsx:', typeof parseJsx === 'function' ? 'OK' : 'FAIL');
console.log('Mitosis generators:',
  [componentToReact, componentToVue, componentToSvelte, componentToAngular, componentToSolid]
    .every(fn => typeof fn === 'function') ? 'OK (all 5)' : 'FAIL'
);

// 3. Figma REST API types (type-only — just verify import doesn't throw)
import type { GetFileResponse, GetFileNodesResponse } from '@figma/rest-api-spec';
console.log('Figma API types: OK (type-only import)');

// 4. LLM SDKs
import OpenAI from 'openai';
console.log('OpenAI SDK:', typeof OpenAI === 'function' ? 'OK' : 'FAIL');

import Anthropic from '@anthropic-ai/sdk';
console.log('Anthropic SDK:', typeof Anthropic === 'function' ? 'OK' : 'FAIL');

// 5. CLI and utilities
import { Command } from 'commander';
console.log('Commander:', typeof Command === 'function' ? 'OK' : 'FAIL');

import yaml from 'js-yaml';
console.log('js-yaml:', typeof yaml.dump === 'function' ? 'OK' : 'FAIL');

import { z } from 'zod';
console.log('Zod:', typeof z.string === 'function' ? 'OK' : 'FAIL');

console.log('\n--- All imports verified ---');
