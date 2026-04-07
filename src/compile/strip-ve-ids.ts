/**
 * Strips data-ve-id attributes from generated component code.
 *
 * data-ve-id is injected by injectDataVeIds() to power visual edit click-tracking
 * in the browser preview. It must be present in the in-memory preview copy but
 * must NOT appear in disk output, SSE code display payloads, or download ZIPs —
 * it has no meaning outside the preview iframe and adds noise to production code.
 */

/**
 * Remove all `data-ve-id="..."` occurrences from a single code string.
 */
export function stripDataVeIds(code: string): string {
  return code.replace(/\s*data-ve-id="[^"]*"/g, '');
}

/**
 * Strip data-ve-id from every entry in a framework outputs map.
 * Returns a new object — does not mutate the input.
 */
export function stripAllDataVeIds(
  outputs: Record<string, string>,
): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [fw, code] of Object.entries(outputs)) {
    clean[fw] = stripDataVeIds(code);
  }
  return clean;
}
