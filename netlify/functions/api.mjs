import { getDatabase } from '@netlify/database';
import { createHostedHandler } from '../../server/hosted.js';
import { createClient } from '@libsql/client/web';
import { createPilotHandler } from '../../server/pilot/handler.js';
import { validatePilotUrl } from '../../server/pilot/store.js';

let pool;
let pilotClient;
export default async (request, context) => {
  const mode = Netlify.env.get('RALLYFUND_MODE') || 'review';
  if (mode !== 'review') {
    try {
      const origin = new URL(Netlify.env.get('RALLYFUND_PILOT_ORIGIN')).origin;
      if (
        mode !== 'pilot' ||
        origin === 'https://volleyball-fundraiser.netlify.app' ||
        !origin.startsWith('https://') ||
        origin !== new URL(context.site.url.replace(/^http:/, 'https:')).origin ||
        origin !== new URL(request.url).origin
      )
        throw new Error('Pilot host mismatch');
      const authToken = Netlify.env.get('RALLYFUND_TURSO_AUTH_TOKEN');
      if (!authToken) throw new Error('Missing pilot credentials');
      pilotClient ||= createClient({
        url: validatePilotUrl(Netlify.env.get('RALLYFUND_TURSO_DATABASE_URL')),
        authToken,
      });
      return createPilotHandler({ client: pilotClient, origins: [origin] })(request, context);
    } catch {
      return Response.json(
        { error: 'Pilot access is not configured.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }
  const origins = [
    context.site?.url,
    context.site?.name && context.deploy?.id
      ? `https://${context.deploy.id}--${context.site.name}.netlify.app`
      : null,
    Netlify.env.get('URL'),
    Netlify.env.get('DEPLOY_URL'),
    Netlify.env.get('DEPLOY_PRIME_URL'),
  ]
    .filter(Boolean)
    .map((value) => new URL(value.replace(/^http:/, 'https:')).origin);
  try {
    pool ||= getDatabase().pool;
    return await createHostedHandler({
      pool,
      password: Netlify.env.get('PROTOTYPE_REVIEW_PASSWORD'),
      origins,
    })(request, context);
  } catch (error) {
    console.error('Hosted review configuration failure', { name: error.name, code: error.code });
    return Response.json(
      { error: 'Hosted review storage is not configured.' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      },
    );
  }
};

export const config = { path: ['/api', '/api/*'] };
