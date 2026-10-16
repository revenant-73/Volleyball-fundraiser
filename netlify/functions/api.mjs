import { getDatabase } from '@netlify/database';
import { createHostedHandler } from '../../server/hosted.js';
import { createPilotHandler } from '../../server/pilot/handler.js';
import { hostedPilotResources } from '../../server/pilot/host.js';

let pool;
export default async (request, context) => {
  const mode = Netlify.env.get('RALLYFUND_MODE') || 'review';
  if (mode !== 'review') {
    try {
      const { client, services } = hostedPilotResources(context, new URL(request.url).origin);
      return createPilotHandler({
        client,
        services,
        origins: [Netlify.env.get('RALLYFUND_PILOT_ORIGIN')],
      })(request, context);
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
