import { getDatabase } from '@netlify/database';
import { createHostedHandler } from '../../server/hosted.js';

let pool;
export default async (request, context) => {
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
