/** Deployment settings needed by the Dashboard cookie authentication adapter. */
export interface BrowserAuthConfig {
  readonly allowedOrigins: readonly string[];
  readonly csrfSecret?: string;
  readonly cookieSameSite: 'lax' | 'none';
}

export const IAM_BROWSER_AUTH_CONFIG = Symbol('IAM_BROWSER_AUTH_CONFIG');
