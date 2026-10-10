import express from 'express';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeSnapshot } from './store.js';
import {
  Fundraiser,
  createSeed,
  AppError,
  token,
  hash,
  parseAthleteCSV,
  ledgerCSV,
} from './domain.js';

export function createApp({
  directory = null,
  seed = null,
  writeStore = writeSnapshot,
  hosted = false,
  allowedOrigins = [],
  staticFiles = true,
} = {}) {
  let state;
  let links = {};
  let auth = seed?.auth;
  if (directory && existsSync(path.join(directory, 'snapshot.json'))) {
    const saved = JSON.parse(readFileSync(path.join(directory, 'snapshot.json'), 'utf8'));
    state = saved.state;
    links = saved.links;
    auth = saved.auth;
  } else if (directory && existsSync(path.join(directory, 'state.json'))) {
    state = JSON.parse(readFileSync(path.join(directory, 'state.json'), 'utf8'));
    links = JSON.parse(readFileSync(path.join(directory, 'private-links.json'), 'utf8'));
  } else {
    const sample = seed || createSeed();
    state = sample.state;
    links = sample.links;
  }
  const service = new Fundraiser(state);
  const sessions = new Map(auth?.sessions || []);
  const attempts = new Map(auth?.attempts || []);
  for (const [key, session] of sessions) if (session.expires < Date.now()) sessions.delete(key);
  for (const [key, attempt] of attempts)
    if (attempt.start < Date.now() - 60000) attempts.delete(key);
  const snapshot = () => ({
    state: service.state,
    links,
    auth: { sessions: [...sessions], attempts: [...attempts] },
  });
  let lastWritten;
  const persist = () => {
    if (!directory) return;
    mkdirSync(directory, { recursive: true });
    // Keep ledger, idempotency and private capabilities in one atomic snapshot.
    const serialized = JSON.stringify(snapshot(), null, 2);
    if (serialized === lastWritten) return;
    writeStore(directory, serialized);
    lastWritten = serialized;
  };
  persist();
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    if (req.path.startsWith('/api') && !['GET', 'HEAD'].includes(req.method)) {
      if (req.get('X-Prototype') !== 'local')
        return res.status(403).json({ error: 'Prototype request header required.' });
      const origin = req.get('origin');
      const webPort = process.env.PROTOTYPE_WEB_PORT || 5173;
      const apiPort = process.env.PROTOTYPE_API_PORT || 3100;
      if (
        (hosted && !origin) ||
        (origin &&
          ![
            ...allowedOrigins,
            `http://127.0.0.1:${webPort}`,
            `http://localhost:${webPort}`,
            `http://127.0.0.1:${apiPort}`,
            `http://localhost:${apiPort}`,
          ]
            .filter((value) => !hosted || value.startsWith('https://'))
            .includes(origin))
      )
        return res.status(403).json({ error: 'Origin not allowed.' });
    }
    next();
  });
  app.use(express.json({ limit: '3mb' }));
  app.use('/api/admin', (req, res, next) => {
    const raw = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('rally_session='))
      ?.slice('rally_session='.length);
    const session = sessions.get(hash(raw || ''));
    if (!session || session.expires < Date.now())
      return res.status(401).json({ error: 'Administrator sign-in required.' });
    req.session = session;
    next();
  });
  const route = (fn) => (req, res, next) => {
    const mutation = req.method !== 'GET';
    const previous = mutation ? structuredClone(service.state) : null;
    const oldLinks = mutation ? structuredClone(links) : null;
    const oldSessions = mutation ? structuredClone([...sessions]) : null;
    try {
      const result = fn(req, res);
      if (mutation) persist();
      if (!res.headersSent) res.json(result);
    } catch (err) {
      if (mutation) {
        service.state = previous;
        links = oldLinks;
        sessions.clear();
        for (const [key, value] of oldSessions) sessions.set(key, value);
        if (!res.headersSent) res.removeHeader('Set-Cookie');
      }
      next(err);
    }
  };
  const detail = (req) => service.detail(req.session.orgId, req.params.id, links);
  app.get(
    '/api/runtime',
    route(() => ({ hosted, simulation: true })),
  );
  app.get(
    '/api/examples',
    route(() => ({
      campaigns: service.state.campaigns.map((c) => ({
        name: c.name,
        slug: c.slug,
        organizationName: c.organizationName,
      })),
    })),
  );
  app.post(
    '/api/login',
    route((req, res) => {
      const key = hash(req.ip || 'unknown');
      const attempt = attempts.get(key) || { count: 0, start: Date.now() };
      if (Date.now() - attempt.start > 60000) {
        attempt.count = 0;
        attempt.start = Date.now();
      }
      attempt.count++;
      attempts.set(key, attempt);
      if (attempt.count > 15)
        throw new AppError('Too many sign-in attempts. Try again in a minute.', 429);
      const session = service.login(req.body.email, req.body.password);
      // Successful sign-ins are not failed attempts. In particular, repeated
      // authenticated review sessions must not trip the brute-force hold.
      attempts.delete(key);
      const raw = token();
      sessions.set(hash(raw), { ...session, expires: Date.now() + 8 * 60 * 60 * 1000 });
      res.cookie('rally_session', raw, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 8 * 60 * 60 * 1000,
        path: '/',
        secure: hosted,
      });
      return { organization: service.organization(session.orgId) };
    }),
  );
  app.post(
    '/api/logout',
    route((req, res) => {
      const raw = req.headers.cookie
        ?.split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('rally_session='))
        ?.slice('rally_session='.length);
      sessions.delete(hash(raw || ''));
      res.clearCookie('rally_session', { path: '/', secure: hosted, sameSite: 'strict' });
      return { success: true };
    }),
  );
  app.get(
    '/api/session',
    route((req) => {
      const raw = req.headers.cookie
        ?.split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('rally_session='))
        ?.slice('rally_session='.length);
      const session = sessions.get(hash(raw || ''));
      if (!session || session.expires < Date.now()) throw new AppError('Sign-in required.', 401);
      return { organization: service.organization(session.orgId) };
    }),
  );
  app.get(
    '/api/admin',
    route((req) => ({
      organization: service.organization(req.session.orgId),
      campaigns: service.state.campaigns
        .filter((c) => c.orgId === req.session.orgId)
        .map((c) => service.detail(c.orgId, c.id, links)),
    })),
  );
  app.post(
    '/api/admin/campaigns',
    route((req) => {
      const c = service.createCampaign(req.session.orgId, req.body);
      return service.detail(c.orgId, c.id, links);
    }),
  );
  app.patch(
    '/api/admin/campaigns/:id',
    route((req) => {
      service.updateCampaign(req.session.orgId, req.params.id, req.body);
      return detail(req);
    }),
  );
  app.post(
    '/api/admin/campaigns/:id/duplicate',
    route((req) => {
      const c = service.duplicate(req.session.orgId, req.params.id, req.body);
      return service.detail(c.orgId, c.id, links);
    }),
  );
  app.post(
    '/api/admin/campaigns/:id/action',
    route((req) => {
      service.action(req.session.orgId, req.params.id, req.body);
      return detail(req);
    }),
  );
  app.post(
    '/api/admin/campaigns/:id/athletes',
    route((req) => {
      const result = service.addAthlete(req.session.orgId, req.params.id, req.body);
      links[result.athlete.id] = result.privatePath;
      return result;
    }),
  );
  app.post(
    '/api/admin/campaigns/:id/import',
    route((req) => {
      service.campaign(req.session.orgId, req.params.id);
      const { athletes, errors } = parseAthleteCSV(req.body.csv);
      if (errors.length) return { imported: [], errors };
      const imported = athletes.map((a) => {
        const result = service.addAthlete(req.session.orgId, req.params.id, a);
        links[result.athlete.id] = result.privatePath;
        return result;
      });
      return { imported, errors: [] };
    }),
  );
  app.post(
    '/api/admin/campaigns/:id/athletes/:athleteId/invite',
    route((req) => {
      if (req.body.revoke) {
        service.campaign(req.session.orgId, req.params.id);
        const a = service.findAthlete(req.params.id, req.params.athleteId);
        a.inviteHash = null;
        a.invitationStatus = 'revoked';
        delete links[a.id];
        service.log(
          service.campaign(a.orgId, a.campaignId),
          'invite-revoked',
          'Private athlete invitation revoked.',
        );
        return { privatePath: null };
      }
      const privatePath = service.issueInvite(
        req.session.orgId,
        req.params.id,
        req.params.athleteId,
      );
      links[req.params.athleteId] = privatePath;
      return { privatePath };
    }),
  );
  app.post(
    '/api/admin/campaigns/:id/athletes/:athleteId/approve',
    route((req) => {
      service.approve(req.session.orgId, req.params.id, req.params.athleteId, req.body);
      return detail(req);
    }),
  );
  app.post(
    '/api/admin/campaigns/:id/ledger/:donationId',
    route((req) => {
      service.reconcile(
        req.session.orgId,
        req.params.id,
        req.params.donationId,
        req.body,
        req.session.userId,
      );
      return detail(req);
    }),
  );
  app.post(
    '/api/admin/campaigns/:id/suppress',
    route((req) => {
      service.suppress(req.session.orgId, req.params.id, req.body.email, req.body.reason);
      return detail(req);
    }),
  );
  app.post(
    '/api/admin/campaigns/:id/jobs/:jobId/retry',
    route((req) => {
      service.jobAction(req.session.orgId, req.params.id, req.params.jobId, 'retry');
      return detail(req);
    }),
  );
  app.post(
    '/api/admin/campaigns/:id/jobs/:jobId/fail',
    route((req) => {
      service.jobAction(req.session.orgId, req.params.id, req.params.jobId, 'fail');
      return detail(req);
    }),
  );
  app.get(
    '/api/admin/campaigns/:id/export',
    route((req, res) => {
      const c = detail(req);
      res.type('text/csv').attachment(`${c.slug}-ledger.csv`).send(ledgerCSV(c.ledger));
    }),
  );
  app.get(
    '/api/athlete/:token',
    route((req) => service.athleteView(service.athleteByToken(req.params.token))),
  );
  app.patch(
    '/api/athlete/:token',
    route((req) => service.saveAthlete(req.params.token, req.body)),
  );
  app.get(
    '/api/public/:slug',
    route((req) => service.publicView(req.params.slug, req.query.athlete, req.query.contact)),
  );
  app.post(
    '/api/public/:slug/donations',
    route((req) => service.createDonation(req.params.slug, req.body)),
  );
  app.post(
    '/api/simulator/payments',
    route((req) => ({ donation: service.simulatorEvent(req.body.receiptToken, req.body.eventId) })),
  );
  app.get(
    '/api/receipt/:token',
    route((req) => service.receipt(req.params.token)),
  );
  app.post(
    '/api/receipt/:token/report',
    route((req) => service.reportPayment(req.params.token, req.body)),
  );
  app.post(
    '/api/unsubscribe/:token',
    route((req) => service.unsubscribe(req.params.token)),
  );
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
  const dist = path.resolve('dist');
  if (staticFiles && existsSync(dist)) {
    app.use(express.static(dist, { index: false }));
    app.get('/{*path}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (!err.status) {
      // Never log a request URL, body, contact list, or invitation capability.
      console.error('Local prototype failure', {
        name: err.name,
        code: err.code,
        location: err.stack?.split('\n')[1]?.trim(),
      });
    }
    res
      .status(err.status || 500)
      .json({ error: err.status ? err.message : 'Unexpected local server error.' });
  });
  return { app, service, persist, snapshot };
}
