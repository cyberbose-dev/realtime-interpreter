import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

// Serves the Vite build (copied into the package as ./site) and a runtime /config.json.
const siteDir = join(process.env.LAMBDA_TASK_ROOT ?? process.cwd(), 'site');
const region = process.env.AWS_REGION!;
const cognitoDomain = process.env.COGNITO_DOMAIN!;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

const files = new Map<string, Buffer>();
(function load(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) load(p);
    else files.set('/' + relative(siteDir, p).split('\\').join('/'), readFileSync(p));
  }
})(siteDir);

const SECURITY_HEADERS = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src 'self' ${cognitoDomain} wss://transcribestreaming.${region}.amazonaws.com:8443`,
    `form-action 'self' ${cognitoDomain}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; '),
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  // The OAuth callback URL carries the authorization code; never leak it.
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'microphone=(self), display-capture=(self), camera=()',
  'cross-origin-opener-policy': 'same-origin',
};

const config = JSON.stringify({
  region,
  clientId: process.env.CLIENT_ID,
  cognitoDomain,
  selfSignUp: process.env.SELF_SIGN_UP === 'true',
});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const path = event.rawPath === '/' ? '/index.html' : event.rawPath;
  if (path === '/config.json') {
    return {
      statusCode: 200,
      headers: { ...SECURITY_HEADERS, 'content-type': TYPES['.json'], 'cache-control': 'no-store' },
      body: config,
    };
  }
  const file = files.get(path);
  if (!file) {
    return { statusCode: 404, headers: { ...SECURITY_HEADERS, 'content-type': 'text/plain' }, body: 'Not found' };
  }
  const type = TYPES[extname(path)] ?? 'application/octet-stream';
  const text = type.startsWith('text/') || type.includes('json') || type.includes('svg');
  return {
    statusCode: 200,
    headers: {
      ...SECURITY_HEADERS,
      'content-type': type,
      // Vite puts content-hashed files under /assets.
      'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    },
    body: text ? file.toString('utf8') : file.toString('base64'),
    isBase64Encoded: !text,
  };
};
