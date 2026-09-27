// Cognito managed login with the authorization code flow + PKCE (no client secret, no SDK).
import { getConfig } from './config.ts';

interface Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
}

const TOKENS_KEY = 'auth.tokens';
const PKCE_KEY = 'auth.pkce';
const redirectUri = () => `${location.origin}/`;

let tokens: Tokens | null = read<Tokens>(TOKENS_KEY);
let refreshing: Promise<string> | null = null;

export class LoginRequired extends Error {}

function read<T>(key: string): T | null {
  try {
    const v = sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: tokens stay in memory only */
  }
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export const isLoggedIn = () => tokens !== null || getConfig().dev === true;

export async function login(): Promise<void> {
  const { cognitoDomain, clientId } = getConfig();
  const verifier = random(48);
  const state = random(16);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  write(PKCE_KEY, { verifier, state });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: 'openid email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    lang: 'ja',
  });
  location.assign(`${cognitoDomain}/oauth2/authorize?${params}`);
}

/** Completes the redirect from managed login. Returns true when the URL carried an authorization code. */
export async function handleCallback(): Promise<boolean> {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code && !url.searchParams.has('error')) return false;
  history.replaceState(null, '', '/');
  const pkce = read<{ verifier: string; state: string }>(PKCE_KEY);
  write(PKCE_KEY, null);
  if (!code || !pkce || pkce.state !== state) return false;
  const { clientId } = getConfig();
  await tokenRequest({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri(),
    code_verifier: pkce.verifier,
  });
  return true;
}

async function tokenRequest(body: Record<string, string>): Promise<string> {
  const { cognitoDomain } = getConfig();
  const res = await fetch(`${cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (res.status === 400 || res.status === 401) {
    // Refresh token expired or revoked.
    setTokens(null);
    throw new LoginRequired();
  }
  if (!res.ok) throw new Error(`token endpoint: ${res.status}`);
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  setTokens({
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? tokens?.refreshToken,
    expiresAt: Date.now() + t.expires_in * 1000,
  });
  return t.access_token;
}

function setTokens(t: Tokens | null) {
  tokens = t;
  write(TOKENS_KEY, t);
}

/** A valid access token, refreshed when it expires within a minute. Network errors are thrown for the caller to retry. */
export async function getAccessToken(force = false): Promise<string> {
  if (getConfig().dev) return 'dev';
  if (!tokens) throw new LoginRequired();
  if (!force && tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken;
  if (!tokens.refreshToken) {
    setTokens(null);
    throw new LoginRequired();
  }
  refreshing ??= tokenRequest({
    grant_type: 'refresh_token',
    client_id: getConfig().clientId,
    refresh_token: tokens.refreshToken,
  }).finally(() => (refreshing = null));
  return refreshing;
}

export async function logout(): Promise<void> {
  const { cognitoDomain, clientId } = getConfig();
  const refreshToken = tokens?.refreshToken;
  setTokens(null);
  if (refreshToken) {
    // Invalidate the refresh token (and the tokens issued from it) instead of letting it live until expiry.
    await fetch(`${cognitoDomain}/oauth2/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken, client_id: clientId }),
    }).catch(() => undefined);
  }
  const params = new URLSearchParams({ client_id: clientId, logout_uri: redirectUri() });
  location.assign(`${cognitoDomain}/logout?${params}`);
}
