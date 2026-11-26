import serverless from 'serverless-http';
import { randomBytes, scryptSync } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createApp } from './app.js';
import { createSeed, hash } from './domain.js';
import { createStripeSandboxSeed } from './stripe-sandbox.js';

// One locked snapshot deliberately reuses the tested milestone domain model.
// The database serializes writers across function instances; responses leave
// only after COMMIT, including login cookies and idempotency capabilities.
export async function transactSnapshot(pool, initial, operation, snapshotId = 'review-v1') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '15000'");
    await client.query("SET LOCAL lock_timeout = '10000'");
    let result = await client.query(
      'SELECT snapshot FROM fundraiser_review_state WHERE id = $1 FOR UPDATE',
      [snapshotId],
    );
    if (!result.rows.length) {
      await client.query(
        'INSERT INTO fundraiser_review_state (id, snapshot) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING',
        [snapshotId, JSON.stringify(initial())],
      );
      result = await client.query(
        'SELECT snapshot FROM fundraiser_review_state WHERE id = $1 FOR UPDATE',
        [snapshotId],
      );
    }
    const snapshot = result.rows[0].snapshot;
    const before = structuredClone(snapshot);
    const outcome = await operation(snapshot);
    const after = JSON.stringify(outcome.snapshot);
    if (!isDeepStrictEqual(before, outcome.snapshot))
      await client.query(
        'UPDATE fundraiser_review_state SET snapshot = $2::jsonb, revision = revision + 1, updated_at = now() WHERE id = $1',
        [snapshotId, after],
      );
    await client.query('COMMIT');
    return outcome.response;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function protectReview(snapshot, password) {
  const version = hash(password);
  if (snapshot.state.reviewPasswordVersion === version) return;
  for (const user of snapshot.state.users) {
    user.salt = randomBytes(16).toString('hex');
    user.passwordHash = scryptSync(password, user.salt, 64).toString('hex');
  }
  snapshot.state.reviewPasswordVersion = version;
  // Rotating the hosted password also revokes old administrator sessions.
  snapshot.auth = { sessions: [], attempts: [] };
}

const errorResponse = (message) =>
  Response.json(
    { error: message },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } },
  );

export function createHostedHandler({ pool, password, origins, stripeSandbox = null }) {
  const label = stripeSandbox ? 'Hosted QA' : 'Hosted review';
  return async (request, context = {}) => {
    // Never fall back to published local credentials or ephemeral storage.
    if (!password || password.length < 24)
      return errorResponse(`${label} access is not configured. Contact the project administrator.`);
    const url = new URL(request.url);
    if (!origins.includes(url.origin)) return new Response('Unknown review host.', { status: 403 });
    const signedEvent =
      stripeSandbox && request.method === 'POST' && url.pathname === '/api/stripe-sandbox/webhook';
    const body = ['GET', 'HEAD'].includes(request.method)
      ? Buffer.alloc(0)
      : Buffer.from(await request.arrayBuffer());
    if (body.length > 3 * 1024 * 1024)
      return Response.json(
        { error: 'Request exceeds the prototype upload limit.' },
        { status: 413 },
      );
    try {
      return await transactSnapshot(
        pool,
        stripeSandbox ? createStripeSandboxSeed : createSeed,
        async (snapshot) => {
          protectReview(snapshot, password);
          const runtime = createApp({
            seed: snapshot,
            hosted: true,
            allowedOrigins: origins,
            staticFiles: false,
            stripeSandbox,
          });
          const result = await serverless(runtime.app)(
            {
              version: '2.0',
              rawPath: url.pathname,
              rawQueryString: url.search.slice(1),
              headers: Object.fromEntries(request.headers),
              body: body.toString(signedEvent ? 'base64' : 'utf8'),
              isBase64Encoded: Boolean(signedEvent),
              requestContext: {
                http: { method: request.method, sourceIp: context.ip || 'unknown' },
              },
            },
            {},
          );
          const headers = new Headers(result.headers);
          for (const [name, values] of Object.entries(result.multiValueHeaders || {})) {
            headers.delete(name);
            for (const value of values) headers.append(name, value);
          }
          for (const cookie of result.cookies || []) headers.append('set-cookie', cookie);
          const output = result.isBase64Encoded ? Buffer.from(result.body, 'base64') : result.body;
          return {
            snapshot: runtime.snapshot(),
            response: new Response(request.method === 'HEAD' ? null : output, {
              status: result.statusCode,
              headers,
            }),
          };
        },
        stripeSandbox ? 'stripe-qa-v1' : 'review-v1',
      );
    } catch (error) {
      // Connection strings, payloads, URLs, contact lists and capabilities must
      // never enter logs. An unavailable DB fails closed, preserving old state.
      console.error(`${label} storage failure`, { name: error.name, code: error.code });
      return errorResponse(
        `${stripeSandbox ? 'QA' : 'Review'} storage is temporarily unavailable. Please retry.`,
      );
    }
  };
}
