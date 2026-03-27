import crypto from 'crypto';

/**
 * Generate unique session ID using cryptographically random UUID.
 */
export function generateSessionId(): string {
  return crypto.randomUUID();
}
