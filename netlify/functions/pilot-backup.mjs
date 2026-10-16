import { hostedPilotResources } from '../../server/pilot/host.js';
import { exportPilot } from '../../server/pilot/backup.js';

export default async (request, context) => {
  // Scheduled functions cannot be invoked as a public HTTP endpoint. The
  // explicit site/deploy gate also prevents review and previews opening stores.
  if (Netlify.env.get('RALLYFUND_MODE') !== 'pilot') return new Response(null, { status: 204 });
  try {
    const { client, services } = hostedPilotResources(context);
    const result = await services.backups.run(await exportPilot(client));
    console.log('Pilot backup verified', { id: result.id, mediaCount: result.mediaCount });
    return new Response(null, { status: 204 });
  } catch {
    console.error(
      'Pilot backup failed. Inspect owner Operations status; no private details logged.',
    );
    return new Response('Backup failed.', { status: 500 });
  }
};

// One verified daily snapshot; hourly invocations retry transient failures.
export const config = { schedule: '0 * * * *' };
