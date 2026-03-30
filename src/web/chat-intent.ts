/**
 * Heuristic intent classifier for chat messages.
 *
 * Detects whether a user message is conversational (greetings, affirmations,
 * general questions) vs. a code-change request. Conversational messages skip
 * the full Mitosis/compile refinement pipeline.
 */

const GREETING_PATTERNS = /^(h(i|ello|ey|owdy)|yo|sup|good\s*(morning|afternoon|evening)|greetings|what'?s\s*up)\b/i;
const FAREWELL_PATTERNS = /^(bye|goodbye|see\s*you|later|take\s*care|thanks?|thank\s*you|cheers|thx|ty)\b/i;
const AFFIRMATION_PATTERNS = /^(looks?\s*good|great|nice|awesome|perfect|cool|ok(ay)?|got\s*it|sounds?\s*good|lgtm|well\s*done|love\s*it|neat|sweet|excellent|wonderful|amazing|fantastic|brilliant)\s*[.!]?$/i;
const META_QUESTIONS = /^(what\s+(can|do)\s+you\s+do|what\s+you\s+can\s+do|what\s+(are|is)\s+your\s+(capabilities|features|functions)|how\s+does\s+this\s+work|how\s+do\s+(you|i)\s+use\s+this|who\s+are\s+you|what\s+are\s+you|help\s*me|tell\s*me\s*about\s*(yourself|this\s*tool)|what\s+is\s+this(\s+tool)?)/i;
const GENERAL_CHAT = /^(lol|haha|hmm+|wow|oh|ah|yep|yup|nope|no\s*worries|sure|right|exactly|indeed|true|fair\s*enough)\s*[.!?]?$/i;

const CODE_ACTION_VERBS = /\b(change|update|add|remove|delete|fix|make|move|replace|resize|set|increase|decrease|adjust|modify|rename|swap|convert|align|center|wrap|hide|show|toggle|create|insert|rewrite|refactor|style|apply|use|put|give|turn)\b/i;
const CSS_STYLE_TERMS = /\b(color|font|padding|margin|border|background|width|height|size|radius|shadow|opacity|gap|flex|grid|display|position|top|bottom|left|right|z-index|overflow|text-align|line-height|letter-spacing|weight|bold|italic|underline|px|rem|em|rgb|hex|#[0-9a-f]{3,8})\b/i;
const COMPONENT_TERMS = /\b(button|header|footer|nav|sidebar|input|form|card|modal|dialog|table|list|image|icon|text|label|title|heading|paragraph|link|container|wrapper|section|div|span|checkbox|radio|select|dropdown|menu|tab|badge|tag|chip|avatar|tooltip|popover|accordion|carousel|slider|progress|spinner|loader)\b/i;

/**
 * Classify a chat message as either a code-change request or conversational.
 *
 * Returns `'conversational'` only when there's a strong signal the message
 * is not a code request. Defaults to `'code_change'` (safe fallback).
 */
export function classifyMessageIntent(text: string): 'code_change' | 'conversational' {
  const trimmed = text.trim();

  // Empty — default to code_change (safe)
  if (trimmed.length === 0) return 'code_change';

  // Single character or just punctuation — safe fallback
  if (trimmed.length === 1) return 'code_change';

  // If it contains code-change signals, always treat as code_change
  if (CODE_ACTION_VERBS.test(trimmed)) return 'code_change';
  if (CSS_STYLE_TERMS.test(trimmed)) return 'code_change';
  if (COMPONENT_TERMS.test(trimmed)) return 'code_change';

  // Check conversational patterns
  if (GREETING_PATTERNS.test(trimmed)) return 'conversational';
  if (FAREWELL_PATTERNS.test(trimmed)) return 'conversational';
  if (AFFIRMATION_PATTERNS.test(trimmed)) return 'conversational';
  if (META_QUESTIONS.test(trimmed)) return 'conversational';
  if (GENERAL_CHAT.test(trimmed)) return 'conversational';

  // Default: treat as code_change (preserves current behavior)
  return 'code_change';
}
