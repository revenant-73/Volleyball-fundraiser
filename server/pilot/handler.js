import serverless from 'serverless-http';
import { createApp } from '../app.js';
import { transactPilot } from './store.js';

export function createPilotHandler({ client, origins, services = null }) {
  return async (request, context = {}) => {
    const url = new URL(request.url);
    if (!origins.includes(url.origin)) return new Response('Unknown pilot host.', { status: 403 });
    const body = ['GET', 'HEAD'].includes(request.method) ? '' : await request.text();
    if (Buffer.byteLength(body) > 3 * 1024 * 1024)
      return Response.json({ error: 'Request too large.' }, { status: 413 });
    try {
      return await transactPilot(client, async (snapshot) => {
        const runtime = createApp({
          seed: snapshot,
          pilot: true,
          hosted: url.protocol === 'https:',
          allowedOrigins: origins,
          staticFiles: false,
          clientIp: context.ip,
          pilotServices: services,
        });
        const result = await serverless(runtime.app, {
          binary: ['image/webp', 'application/octet-stream'],
        })(
          {
            version: '2.0',
            rawPath: url.pathname,
            rawQueryString: url.search.slice(1),
            headers: Object.fromEntries(request.headers),
            body,
            isBase64Encoded: false,
            requestContext: { http: { method: request.method, sourceIp: context.ip || 'unknown' } },
          },
          {},
        );
        Object.assign(snapshot, runtime.snapshot());
        const headers = new Headers(result.headers);
        for (const [name, values] of Object.entries(result.multiValueHeaders || {})) {
          headers.delete(name);
          for (const value of values) headers.append(name, value);
        }
        for (const cookie of result.cookies || []) headers.append('set-cookie', cookie);
        const output = result.isBase64Encoded
          ? Buffer.from(result.body, 'base64')
          : Buffer.from(result.body || '');
        let responseBody = output;
        if (headers.get('content-disposition')?.includes('.enc')) {
          headers.delete('content-length');
          let offset = 0;
          responseBody = new ReadableStream({
            pull(controller) {
              if (offset >= output.length) {
                controller.close();
                return;
              }
              controller.enqueue(output.subarray(offset, offset + 65536));
              offset += 65536;
            },
          });
        }
        return new Response(request.method === 'HEAD' ? null : responseBody, {
          status: result.statusCode,
          headers,
        });
      });
    } catch (error) {
      // Never log provider messages, URLs, SQL arguments or capabilities.
      console.error('Pilot transaction failed', { name: error.name });
      return Response.json(
        { error: 'Pilot storage is temporarily unavailable. Please retry.' },
        { status: 503, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } },
      );
    }
  };
}
