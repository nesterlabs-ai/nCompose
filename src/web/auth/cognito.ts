/**
 * Server-side Cognito JWT verification using aws-jwt-verify.
 * Lazy-initialises the verifier only when auth is enabled.
 */
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { config } from '../../config.js';

export interface CognitoUser {
  sub: string;
  email: string;
  name?: string;
}

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

export function isAuthEnabled(): boolean {
  return Boolean(config.cognito.userPoolId);
}

function getVerifier() {
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: config.cognito.userPoolId,
      clientId: config.cognito.clientId,
      tokenUse: 'id',
    });
  }
  return verifier;
}

export async function verifyIdToken(token: string): Promise<CognitoUser | null> {
  if (!isAuthEnabled()) return null;

  try {
    const payload = await getVerifier().verify(token);
    return {
      sub: payload.sub,
      email: (payload.email as string) || '',
      name: (payload.name as string) || undefined,
    };
  } catch {
    return null;
  }
}
