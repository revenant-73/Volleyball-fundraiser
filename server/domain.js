import {
  randomBytes,
  randomUUID,
  createHash,
  createHmac,
  timingSafeEqual,
  scryptSync,
} from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status) => {
  throw new AppError(message, status);
};
export const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
const id = () => randomUUID();
const DAY = 86400000;
const normalizedEmail = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();
const validEmail = (value) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value) && value.length <= 254;
const dateValid = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
  !isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const dateAdd = (date, days) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
const localDate = (now, timezone) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
const money = (value, allowZero = false) => {
  if (
    value === '' ||
    value === null ||
    value === undefined ||
    !/^\d+(\.\d{1,2})?$/.test(String(value))
  )
    fail('Enter an amount with at most two decimal places.');
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents) || cents < (allowZero ? 0 : 1) || cents > 100000000)
    fail('Amount is outside the supported range.');
  return cents;
};
const text = (value, max = 500) =>
  String(value ?? '')
    .trim()
    .slice(0, max);
const safeEqual = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const masked = (email) => `${email.slice(0, 1)}***@${email.split('@')[1]}`;
const scheduleDefault = () => [
  {
    id: 'invitation',
    day: 1,
    enabled: true,
    subject: 'Support {{campaign}}',
    body: '{{organization}} invites you to support {{athlete}}. {{message}}\nGive here: {{link}}',
  },
  {
    id: 'reminder',
    day: 10,
    enabled: true,
    subject: 'A rally for {{campaign}}',
    body: 'A fundraising reminder from {{organization}} for {{athlete}}. {{message}}\n{{link}}',
  },
  {
    id: 'final',
    day: 20,
    enabled: true,
    subject: 'Last chance to join the rally',
    body: 'The {{organization}} campaign is almost finished. Support {{athlete}}: {{link}}',
  },
];
const methodsDefault = (org) => ({
  stripe: { enabled: org === 'tvvc' },
  venmo: { enabled: org === 'tvvc', profile: '', instructions: '' },
  school: { enabled: org === 'century', url: '', instructions: '' },
  check: { enabled: org === 'century', payee: '', address: '', instructions: '' },
});

export function createSeed(now = new Date().toISOString()) {
  const state = {
    version: 1,
    organizations: [
      {
        id: 'tvvc',
        name: 'Tualatin Valley Volleyball Club',
        color: '#39c6b0',
        receiptWording:
          'Thank you for supporting TVVC volleyball. TVVC is a for-profit organization. This contribution is not tax-deductible; this is a payment acknowledgement, not a charitable tax receipt.',
      },
      {
        id: 'century',
        name: 'Century High School Volleyball',
        color: '#d3b36b',
        receiptWording:
          'Thank you for supporting Century volleyball. This is a payment acknowledgement. School-approved receipt and tax wording must be configured before launch; no tax-deductibility claim is made.',
      },
    ],
    users: [],
    campaigns: [],
    athletes: [],
    contacts: [],
    ledger: [],
    jobs: [],
    activity: [],
    audit: [],
    suppressions: [],
    requests: {},
    events: {},
  };
  for (const org of state.organizations) {
    const salt = token();
    state.users.push({
      id: id(),
      orgId: org.id,
      email: `coach@${org.id}.example`,
      salt,
      passwordHash: scryptSync('prototype-only', salt, 64).toString('hex'),
    });
  }
  const service = new Fundraiser(state);
  const links = {};
  for (const org of state.organizations) {
    const c = service.createCampaign(
      org.id,
      {
        name: org.id === 'tvvc' ? 'Keep the rally going' : 'One team. One rally.',
        purpose:
          'Sample campaign: help our volleyball athletes with training, equipment, and team experiences.',
        goal: org.id === 'tvvc' ? 7500 : 10000,
        startDate: localDate(now, 'America/Los_Angeles'),
        timezone: 'America/Los_Angeles',
      },
      now,
    );
    const samples =
      org.id === 'tvvc'
        ? [
            ['Maya', 'Varsity', true],
            ['Alex', 'Varsity', true],
            ['Jordan', 'JV', false],
          ]
        : [['Casey', 'Varsity', true]];
    for (const [name, team, completed] of samples) {
      const result = service.addAthlete(org.id, c.id, { name, displayName: name, team });
      const a = state.athletes.find((x) => x.id === result.athlete.id);
      links[a.id] = result.privatePath;
      if (completed) {
        a.completed = true;
        a.authorization = true;
        a.message =
          'Every practice is a chance to get better. Thanks for helping our team keep playing!';
        a.approved = true;
        a.approvedProfile = { displayName: a.displayName, photo: '', message: a.message };
        a.authorizationNote =
          'Synthetic demo athlete; no real minor data or actual guardian authorization.';
        service.addContacts(a, `supporter@example.test ${name.toLowerCase()}-fan@example.test`);
      }
    }
  }
  state.activity = [];
  return { state, links };
}

export class Fundraiser {
  constructor(state, eventSecret = token()) {
    this.state = state;
    this.eventSecret = eventSecret;
  }
  organization(orgId) {
    return (
      this.state.organizations.find((o) => o.id === orgId) || fail('Organization not found.', 404)
    );
  }
  campaign(orgId, campaignId) {
    return (
      this.state.campaigns.find((c) => c.id === campaignId && c.orgId === orgId) ||
      fail('Campaign not found.', 404)
    );
  }
  publicCampaign(slug) {
    return this.state.campaigns.find((c) => c.slug === slug) || fail('Campaign not found.', 404);
  }
  log(c, type, detail) {
    this.state.activity.push({ id: id(), campaignId: c.id, at: c.now, type, detail });
  }
  login(email, password) {
    const user = this.state.users.find((u) => u.email === normalizedEmail(email));
    const derived = scryptSync(
      String(password || '').slice(0, 200),
      user?.salt || 'dummy-salt',
      64,
    ).toString('hex');
    if (!user || !safeEqual(derived, user.passwordHash))
      fail('Email or password is incorrect.', 401);
    return { userId: user.id, orgId: user.orgId };
  }
  createCampaign(orgId, input, now = new Date().toISOString()) {
    const org = this.organization(orgId);
    const startDate = input.startDate || localDate(now, input.timezone || 'America/Los_Angeles');
    const c = {
      id: id(),
      orgId,
      slug: `${orgId}-${randomBytes(5).toString('hex')}`,
      name: '',
      purpose: '',
      goalCents: 0,
      startDate,
      endDate: input.endDate || dateAdd(startDate, 20),
      timezone: 'America/Los_Angeles',
      organizationName: org.name,
      color: org.color,
      logo: '',
      paymentSettings: methodsDefault(orgId),
      schedule: scheduleDefault(),
      status: 'draft',
      now,
    };
    this.validateSettings(c, input);
    this.state.campaigns.push(c);
    this.log(c, 'campaign-created', 'Draft campaign created. No invitations sent.');
    return c;
  }
  validateSettings(c, input) {
    for (const key of ['name', 'purpose', 'organizationName'])
      if (input[key] !== undefined) c[key] = text(input[key], key === 'purpose' ? 3000 : 150);
    if (!c.name || !c.purpose) fail('Campaign name and purpose are required.');
    if (input.goal !== undefined) c.goalCents = money(input.goal);
    if (!c.goalCents) fail('A positive fundraising goal is required.');
    if (input.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: input.timezone });
      } catch {
        fail('Choose a valid IANA timezone.');
      }
      c.timezone = input.timezone;
    }
    for (const key of ['startDate', 'endDate']) if (input[key] !== undefined) c[key] = input[key];
    if (!dateValid(c.startDate) || !dateValid(c.endDate) || c.endDate < c.startDate)
      fail('Campaign dates are invalid.');
    if (input.color !== undefined) {
      if (!/^#[a-fA-F0-9]{6}$/.test(input.color)) fail('Color must be a six-digit hex value.');
      c.color = input.color;
    }
    if (input.logo !== undefined) {
      if (
        input.logo &&
        (!/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(input.logo) ||
          input.logo.length > 2800000)
      )
        fail('Use a PNG, JPEG, or WebP logo under 2 MB.');
      c.logo = input.logo;
    }
    if (input.paymentSettings) {
      for (const method of ['stripe', 'venmo', 'school', 'check']) {
        const incoming = input.paymentSettings[method];
        if (!incoming) continue;
        c.paymentSettings[method] = { ...c.paymentSettings[method], enabled: !!incoming.enabled };
        for (const key of Object.keys(methodsDefault(c.orgId)[method]).filter(
          (k) => k !== 'enabled',
        ))
          if (incoming[key] !== undefined)
            c.paymentSettings[method][key] = text(incoming[key], 1000);
      }
      const url = c.paymentSettings.school.url;
      if (url) {
        try {
          if (new URL(url).protocol !== 'https:') throw new Error();
        } catch {
          fail('School payment URL must be a valid HTTPS URL.');
        }
      }
    }
    if (input.schedule) {
      if (!Array.isArray(input.schedule) || !input.schedule.length || input.schedule.length > 12)
        fail('Schedule must contain 1–12 messages.');
      const uniqueIds = new Set();
      const uniqueDays = new Set();
      c.schedule = input.schedule.map((s) => {
        if (
          !/^[a-zA-Z0-9_-]{1,40}$/.test(s.id) ||
          uniqueIds.has(s.id) ||
          !Number.isInteger(Number(s.day)) ||
          Number(s.day) < 1 ||
          Number(s.day) > 365 ||
          uniqueDays.has(Number(s.day))
        )
          fail('Schedule IDs and days must be valid and unique.');
        uniqueIds.add(s.id);
        uniqueDays.add(Number(s.day));
        if (!text(s.subject) || !text(s.body)) fail('Each message needs a subject and body.');
        return {
          id: s.id,
          day: Number(s.day),
          enabled: !!s.enabled,
          subject: text(s.subject, 200),
          body: text(s.body, 4000),
        };
      });
      if (!c.schedule.some((s) => s.id === 'invitation' && s.day === 1 && s.enabled))
        fail('Keep an enabled Day 1 invitation.');
    }
  }
  updateCampaign(orgId, campaignId, input) {
    const c = this.campaign(orgId, campaignId);
    if (
      c.status !== 'draft' &&
      ['startDate', 'endDate', 'timezone'].some(
        (k) => input[k] !== undefined && JSON.stringify(input[k]) !== JSON.stringify(c[k]),
      )
    )
      fail(
        'Campaign dates/timezone are locked after launch. Duplicate the campaign to change them.',
      );
    const next = structuredClone(c);
    this.validateSettings(next, input);
    Object.assign(c, next);
    if (input.schedule && !['draft', 'closed'].includes(c.status)) {
      const today = localDate(c.now, c.timezone);
      for (const j of this.state.jobs.filter(
        (j) =>
          j.campaignId === c.id &&
          j.type === 'solicitation' &&
          (['queued', 'failed'].includes(j.status) || j.scheduleDisabled),
      )) {
        const contact = this.state.contacts.find((x) => x.id === j.contactId);
        const contactState = this.contactState(contact);
        if (['suppressed', 'donated'].includes(contactState)) {
          j.status = 'blocked';
          j.reason = contactState;
          delete j.scheduleDisabled;
          continue;
        }
        const step = c.schedule.find((s) => s.id === j.stepId);
        if (!step?.enabled) {
          j.status = 'skipped';
          j.reason = 'Message removed or disabled';
          j.scheduleDisabled = true;
          continue;
        }
        j.dueDate = dateAdd(c.startDate, step.day - 1);
        j.day = step.day;
        if (j.dueDate < today || j.dueDate > c.endDate) {
          j.status = 'skipped';
          j.reason = 'Outside remaining window; no backlog';
          delete j.scheduleDisabled;
        } else if (j.scheduleDisabled) {
          j.status = 'queued';
          delete j.scheduleDisabled;
          delete j.reason;
        }
      }
      if (c.status === 'active')
        for (const contact of this.state.contacts.filter((x) => x.campaignId === c.id))
          this.queueSequence(c, contact);
    }
    this.log(
      c,
      'settings-updated',
      'Campaign configuration updated; delivered messages will not repeat.',
    );
    return c;
  }
  duplicate(orgId, campaignId, input = {}) {
    const c = this.campaign(orgId, campaignId);
    return this.createCampaign(
      orgId,
      {
        ...structuredClone(c),
        name: input.name || `${c.name} (copy)`,
        goal: c.goalCents / 100,
        startDate: localDate(c.now, c.timezone),
        endDate: dateAdd(localDate(c.now, c.timezone), 20),
      },
      c.now,
    );
  }
  addAthlete(orgId, campaignId, input) {
    const c = this.campaign(orgId, campaignId);
    if (!text(input.name, 100)) fail('Athlete name is required.');
    const a = {
      id: id(),
      campaignId: c.id,
      orgId,
      name: text(input.name, 100),
      displayName: text(input.displayName || input.name, 60),
      team: text(input.team || 'Team', 100),
      completed: false,
      approved: false,
      photo: '',
      message: '',
      authorization: false,
      invitationStatus: 'issued',
    };
    this.state.athletes.push(a);
    const privatePath = this.issueInvite(orgId, c.id, a.id);
    this.log(c, 'athlete-added', 'Athlete added; private setup link issued.');
    return { athlete: this.adminAthlete(a), privatePath };
  }
  issueInvite(orgId, campaignId, athleteId) {
    this.campaign(orgId, campaignId);
    const a = this.findAthlete(campaignId, athleteId);
    const raw = token();
    a.inviteHash = hash(raw);
    a.invitationStatus = 'issued';
    a.expiresAt = new Date(Date.now() + 90 * DAY).toISOString();
    return `/join/${raw}`;
  }
  findAthlete(campaignId, athleteId) {
    return (
      this.state.athletes.find((a) => a.id === athleteId && a.campaignId === campaignId) ||
      fail('Athlete not found.', 404)
    );
  }
  athleteByToken(raw) {
    return (
      this.state.athletes.find(
        (a) => safeEqual(a.inviteHash, hash(raw)) && new Date(a.expiresAt) > new Date(),
      ) || fail('This private link has expired or was revoked.', 404)
    );
  }
  athleteView(a) {
    const c = this.campaign(a.orgId, a.campaignId);
    const { id, name, displayName, team, photo, message, completed, approved, authorization } = a;
    return {
      athlete: { id, name, displayName, team, photo, message, completed, approved, authorization },
      campaign: {
        name: c.name,
        status: c.status,
        slug: c.slug,
        organizationName: c.organizationName,
      },
      contacts: this.state.contacts
        .filter((x) => x.campaignId === c.id && x.athleteIds.includes(a.id))
        .map((x) => x.email),
      publicPath: `/c/${c.slug}/a/${a.id}`,
    };
  }
  addContacts(a, input) {
    const c = this.campaign(a.orgId, a.campaignId);
    const seen = new Set();
    const result = { added: [], duplicates: [], invalid: [] };
    if (String(input).length > 100000) fail('Paste a smaller batch of contacts.');
    for (const raw of String(input || '')
      .split(/[\s,;]+/)
      .filter(Boolean)) {
      const email = normalizedEmail(raw);
      if (!validEmail(email)) {
        result.invalid.push(raw);
        continue;
      }
      let contact = this.state.contacts.find((x) => x.campaignId === c.id && x.email === email);
      if (seen.has(email) || contact?.athleteIds.includes(a.id)) {
        result.duplicates.push(email);
        continue;
      }
      seen.add(email);
      if (!contact) {
        contact = {
          id: id(),
          orgId: a.orgId,
          campaignId: c.id,
          email,
          athleteIds: [],
          publicToken: token(),
        };
        this.state.contacts.push(contact);
      }
      contact.athleteIds.push(a.id);
      result.added.push(email);
      this.queueSequence(c, contact);
    }
    return result;
  }
  saveAthlete(raw, input) {
    const a = this.athleteByToken(raw);
    const c = this.campaign(a.orgId, a.campaignId);
    let changed = false;
    for (const key of ['displayName', 'message'])
      if (input[key] !== undefined) {
        const next = text(input[key], key === 'message' ? 1500 : 60);
        if (key === 'displayName' && !next) fail('Public display name is required.');
        if (a[key] !== next) changed = true;
        a[key] = next;
      }
    if (input.photo !== undefined) {
      if (
        input.photo &&
        (!/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(input.photo) ||
          input.photo.length > 2800000)
      )
        fail('Upload a PNG, JPEG, or WebP photo under 2 MB.');
      if (a.photo !== input.photo) changed = true;
      a.photo = input.photo;
    }
    if (input.authorization !== undefined) {
      a.authorization = !!input.authorization;
      if (!a.authorization) changed = true;
    }
    if (changed) {
      a.approved = false;
      a.approvedProfile = null;
    }
    const contactResult = this.addContacts(a, input.emails || '');
    if (input.done) {
      if (contactResult.invalid.length) fail('Fix invalid email addresses before clicking Done.');
      if (!a.authorization) fail('Acknowledge athlete/guardian authorization for public content.');
      a.completed = true;
    }
    a.invitationStatus = a.completed ? 'completed' : 'started';
    for (const contact of this.state.contacts.filter(
      (x) => x.campaignId === c.id && x.athleteIds.includes(a.id),
    ))
      this.queueSequence(c, contact);
    return { ...this.athleteView(a), contactResult };
  }
  approve(orgId, campaignId, athleteId, input) {
    const c = this.campaign(orgId, campaignId);
    const a = this.findAthlete(c.id, athleteId);
    if (input.approved) {
      if (!a.completed || !a.authorization || !text(input.authorizationNote))
        fail('Completion, acknowledgement, and administrator authorization record are required.');
      a.authorizationNote = text(input.authorizationNote, 1000);
      a.approvedProfile = { displayName: a.displayName, photo: a.photo, message: a.message };
    } else a.approvedProfile = null;
    a.approved = !!input.approved;
    this.log(
      c,
      'profile-review',
      input.approved
        ? 'Athlete public profile approved; authorization recorded.'
        : 'Athlete public profile approval revoked.',
    );
    for (const contact of this.state.contacts.filter(
      (x) => x.campaignId === c.id && x.athleteIds.includes(a.id),
    ))
      this.queueSequence(c, contact);
  }
  eligible(contact) {
    return contact.athleteIds
      .map((aid) => this.findAthlete(contact.campaignId, aid))
      .filter((a) => a.completed && a.approved);
  }
  contactState(contact) {
    if (this.state.suppressions.some((s) => s.orgId === contact.orgId && s.email === contact.email))
      return 'suppressed';
    const entries = this.state.ledger.filter(
      (d) => d.campaignId === contact.campaignId && d.email === contact.email,
    );
    if (entries.some((d) => d.everConfirmed)) return 'donated';
    if (entries.some((d) => d.status === 'pending' && (d.method === 'stripe' || d.reported)))
      return 'pending';
    return 'active';
  }
  queueSequence(c, contact) {
    if (
      c.status !== 'active' ||
      !this.eligible(contact).length ||
      this.contactState(contact) !== 'active'
    )
      return;
    const today = localDate(c.now, c.timezone);
    if (today > c.endDate) return;
    for (const step of c.schedule.filter((s) => s.enabled)) {
      const jobId = `${c.id}:${contact.id}:${step.id}`;
      if (this.state.jobs.some((j) => j.id === jobId)) continue;
      let dueDate = dateAdd(c.startDate, step.day - 1);
      if (step.id === 'invitation' && dueDate < today) dueDate = today;
      if (dueDate < today || dueDate > c.endDate) continue;
      this.state.jobs.push({
        id: jobId,
        campaignId: c.id,
        contactId: contact.id,
        type: 'solicitation',
        stepId: step.id,
        day: step.day,
        dueDate,
        status: 'queued',
      });
    }
  }
  action(orgId, campaignId, input) {
    const c = this.campaign(orgId, campaignId);
    const transitions = {
      launch: ['draft', 'active'],
      pause: ['active', 'paused'],
      resume: ['paused', 'active'],
    };
    if (transitions[input.action]) {
      const [from, to] = transitions[input.action];
      if (c.status !== from) fail(`Cannot ${input.action} a ${c.status} campaign.`);
      if (localDate(c.now, c.timezone) > c.endDate) fail('Campaign deadline has passed.');
      c.status = to;
      if (input.action === 'resume') this.skipOverdue(c);
      if (to === 'active')
        for (const contact of this.state.contacts.filter((x) => x.campaignId === c.id))
          this.queueSequence(c, contact);
      this.log(c, `campaign-${input.action}`, `Campaign ${to}. Email delivery remains simulated.`);
    } else if (input.action === 'close') {
      c.status = 'closed';
      for (const job of this.state.jobs.filter(
        (j) =>
          j.campaignId === c.id &&
          j.type === 'solicitation' &&
          ['queued', 'failed'].includes(j.status),
      )) {
        job.status = 'blocked';
        job.reason = 'Campaign closed';
      }
      this.log(
        c,
        'campaign-close',
        'Solicitation stopped. Pending donations can still be reconciled.',
      );
    } else if (input.action === 'advance') {
      if (
        !Number.isInteger(Number(input.days)) ||
        Number(input.days) < 1 ||
        Number(input.days) > 365
      )
        fail('Advance by 1–365 whole days.');
      c.now = new Date(Date.parse(c.now) + Number(input.days) * DAY).toISOString();
      this.log(c, 'clock-advanced', `Simulated clock advanced ${input.days} days.`);
      this.run(c);
    } else if (input.action === 'run') this.run(c);
    else fail('Unknown campaign action.');
    return c;
  }
  skipOverdue(c) {
    const today = localDate(c.now, c.timezone);
    for (const j of this.state.jobs.filter(
      (j) =>
        j.campaignId === c.id &&
        j.type === 'solicitation' &&
        ['queued', 'failed'].includes(j.status) &&
        j.dueDate < today,
    )) {
      j.status = 'skipped';
      j.reason = 'Missed window; no backlog';
    }
  }
  renderJob(c, job) {
    const contact = this.state.contacts.find((x) => x.id === job.contactId);
    const athletes = this.eligible(contact);
    const first = athletes[0];
    const link =
      athletes.length === 1
        ? `/c/${c.slug}/a/${first.id}?contact=${contact.publicToken}`
        : `/c/${c.slug}?contact=${contact.publicToken}`;
    const vars = {
      organization: c.organizationName,
      campaign: c.name,
      athlete: athletes.map((a) => a.approvedProfile.displayName).join(' & ') || 'our team',
      message: athletes
        .map((a) => a.approvedProfile.message)
        .filter(Boolean)
        .join('\n'),
      link,
    };
    const fill = (value) =>
      value.replace(/\{\{(organization|campaign|athlete|message|link)\}\}/g, (_, key) => vars[key]);
    if (job.type === 'thank-you')
      return {
        subject: `Thank you for supporting ${c.organizationName}`,
        body: `${this.organization(c.orgId).receiptWording}\nDonation ${job.reference}. This acknowledgement was simulated; no payment was processed.`,
      };
    const step = c.schedule.find((s) => s.id === job.stepId);
    if (!step)
      return {
        subject: 'Removed message',
        body: 'This scheduled fundraising message was removed. No delivery will occur.',
      };
    const approvedMessage = step.body.includes('{{message}}')
      ? ''
      : `\nApproved athlete message: ${vars.message || '(Awaiting profile approval)'}`;
    const fundraiserLink = step.body.includes('{{link}}') ? '' : `\nFundraiser: ${link}`;
    return {
      subject: fill(step.subject),
      body: `Sent by ${c.organizationName} • organization fundraising message\n\n${fill(step.body)}${approvedMessage}${fundraiserLink}\n\nUnsubscribe: /unsubscribe/${contact.publicToken}\nPreview only — no real email sent.`,
    };
  }
  run(c) {
    const today = localDate(c.now, c.timezone);
    if (today > c.endDate && c.status !== 'closed') this.action(c.orgId, c.id, { action: 'close' });
    for (const job of this.state.jobs.filter(
      (j) => j.campaignId === c.id && j.status === 'queued' && j.dueDate <= today,
    )) {
      const contact = this.state.contacts.find((x) => x.id === job.contactId);
      const status = this.contactState(contact);
      const suppression = this.state.suppressions.find(
        (s) => s.orgId === contact.orgId && s.email === contact.email,
      );
      if (
        (suppression && (job.type === 'solicitation' || suppression.reason !== 'unsubscribe')) ||
        (job.type === 'solicitation' && status === 'donated')
      ) {
        job.status = 'blocked';
        job.reason = status;
        continue;
      }
      if (job.type === 'solicitation') {
        if (c.status !== 'active' || status === 'pending') continue;
        if (job.dueDate < today) {
          job.status = 'skipped';
          job.reason = 'Missed window; no backlog';
          continue;
        }
        if (!this.eligible(contact).length) continue;
      }
      job.status = 'sent';
      job.sentAt = c.now;
      job.preview = this.renderJob(c, job);
      this.log(
        c,
        'email-simulated',
        `${job.type === 'thank-you' ? 'Thank-you' : `Day ${job.day}`} simulated for ${masked(contact.email)}. No outbound delivery.`,
      );
    }
  }
  suppress(orgId, campaignId, email, reason) {
    const c = this.campaign(orgId, campaignId);
    email = normalizedEmail(email);
    if (!validEmail(email) || !['unsubscribe', 'complaint', 'hard_bounce'].includes(reason))
      fail('Valid email and suppression reason required.');
    const existing = this.state.suppressions.find((s) => s.orgId === orgId && s.email === email);
    if (!existing) this.state.suppressions.push({ orgId, email, reason, at: c.now });
    else if (reason !== 'unsubscribe') {
      existing.reason = reason;
      existing.at = c.now;
    }
    for (const j of this.state.jobs.filter(
      (j) =>
        ['queued', 'failed'].includes(j.status) &&
        (j.type === 'solicitation' || reason !== 'unsubscribe'),
    )) {
      const contact = this.state.contacts.find((x) => x.id === j.contactId);
      if (contact?.orgId === orgId && contact.email === email) {
        j.status = 'blocked';
        j.reason = reason;
      }
    }
    this.log(c, 'suppression', `${masked(email)} suppressed for this organization (${reason}).`);
  }
  unsubscribe(raw) {
    const contact =
      this.state.contacts.find((x) => safeEqual(x.publicToken, raw)) ||
      fail('Unsubscribe link not found.', 404);
    this.suppress(contact.orgId, contact.campaignId, contact.email, 'unsubscribe');
    return { success: true };
  }
  donationContact(c, email) {
    let contact = this.state.contacts.find((x) => x.campaignId === c.id && x.email === email);
    if (!contact) {
      contact = {
        id: id(),
        orgId: c.orgId,
        campaignId: c.id,
        email,
        athleteIds: [],
        publicToken: token(),
      };
      this.state.contacts.push(contact);
    }
    return contact;
  }
  once(key, payload, fn) {
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(payload.requestId || ''))
      fail('A unique request ID is required.');
    const fingerprint = hash(JSON.stringify(payload));
    const previous = this.state.requests[key];
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        fail('Request ID already used with different details.', 409);
      return structuredClone(previous.result);
    }
    const result = fn();
    this.state.requests[key] = { fingerprint, result: structuredClone(result) };
    return result;
  }
  createDonation(slug, input) {
    const c = this.publicCampaign(slug);
    return this.once(`donation:${c.id}:${input.requestId}`, input, () => {
      if (
        !['active', 'paused'].includes(c.status) ||
        localDate(c.now, c.timezone) < c.startDate ||
        localDate(c.now, c.timezone) > c.endDate
      )
        fail('This campaign is not accepting donations. Preview is available.');
      if (!c.paymentSettings[input.method]?.enabled) fail('Choose an enabled payment method.');
      const email = normalizedEmail(input.email);
      if (!validEmail(email)) fail('Enter a valid donor email.');
      if (input.athleteId) this.findAthlete(c.id, input.athleteId);
      const transaction = text(input.transaction || input.donorReference, 200);
      if (transaction) this.uniqueTransaction(c.orgId, input.method, transaction);
      const reported = input.method === 'stripe' || !input.intent;
      const raw = token();
      const d = {
        id: id(),
        orgId: c.orgId,
        campaignId: c.id,
        reference: `RALLY-${randomBytes(6).toString('hex').toUpperCase()}`,
        email,
        donorName: text(input.donorName || 'Supporter', 100),
        amountCents: money(input.amount),
        feeCents: null,
        method: input.method,
        athleteId: input.athleteId || null,
        status: 'pending',
        reported,
        receivedDate: null,
        transaction,
        receiptHash: hash(raw),
        createdAt: c.now,
        everConfirmed: false,
      };
      this.state.ledger.push(d);
      this.donationContact(c, email);
      this.log(
        c,
        reported ? 'payment-pending' : 'reference-created',
        `${d.reference}: ${reported ? `payment ${input.method === 'stripe' ? 'simulation started' : 'reported'}, pending verification` : 'external payment reference reserved; no payment reported'}.`,
      );
      return {
        donation: this.receiptDonation(d),
        receiptToken: raw,
        paymentSettings: c.paymentSettings,
      };
    });
  }
  receiptDonation(d) {
    const { id, reference, status, amountCents, method, reported } = d;
    return { id, reference, status, amountCents, method, reported };
  }
  receipt(raw) {
    const d =
      this.state.ledger.find((x) => safeEqual(x.receiptHash, hash(raw))) ||
      fail('Receipt not found.', 404);
    return {
      donation: this.receiptDonation(d),
      receiptWording: this.organization(d.orgId).receiptWording,
    };
  }
  reportPayment(raw, input) {
    const d =
      this.state.ledger.find((x) => safeEqual(x.receiptHash, hash(raw))) ||
      fail('Receipt not found.', 404);
    return this.once(`report:${d.id}:${input.requestId}`, input, () => {
      if (d.status !== 'pending' || d.method === 'stripe' || d.reported)
        fail('This external payment has already been reported or resolved.', 409);
      const c = this.campaign(d.orgId, d.campaignId);
      const amountCents = money(input.amount);
      const transaction = text(input.transaction, 200);
      this.uniqueTransaction(d.orgId, d.method, transaction, d.id);
      Object.assign(d, { amountCents, transaction, reported: true });
      this.log(
        c,
        'payment-pending',
        `${d.reference}: external payment reported; reminders paused until administrator resolution.`,
      );
      return this.receipt(raw);
    });
  }
  signEvent(event) {
    return createHmac('sha256', this.eventSecret).update(JSON.stringify(event)).digest('hex');
  }
  simulatorEvent(raw, eventId) {
    const d =
      this.state.ledger.find((x) => safeEqual(x.receiptHash, hash(raw))) ||
      fail('Receipt not found.', 404);
    if (d.method !== 'stripe') fail('Only mock Stripe payments can be confirmed by the simulator.');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(eventId || ''))
      fail('A unique simulated event ID is required.');
    const event = {
      id: eventId,
      donationId: d.id,
      amountCents: d.amountCents,
      type: 'mock.payment_confirmed',
    };
    return this.paymentEvent(event, this.signEvent(event));
  }
  paymentEvent(event, signature) {
    if (!safeEqual(signature, this.signEvent(event))) fail('Invalid payment event signature.', 401);
    const fingerprint = hash(JSON.stringify(event));
    if (this.state.events[event.id]) {
      if (this.state.events[event.id] !== fingerprint) fail('Payment event ID conflict.', 409);
      return this.receiptDonation(this.state.ledger.find((d) => d.id === event.donationId));
    }
    const d =
      this.state.ledger.find((x) => x.id === event.donationId) || fail('Donation not found.', 404);
    const c = this.campaign(d.orgId, d.campaignId);
    if (
      d.method !== 'stripe' ||
      event.type !== 'mock.payment_confirmed' ||
      event.amountCents !== d.amountCents
    )
      fail('Payment event does not match the donation.');
    if (d.status === 'pending') {
      const before = this.auditSnapshot(d);
      d.status = 'confirmed';
      d.everConfirmed = true;
      d.receivedDate = localDate(c.now, c.timezone);
      d.transaction = `MOCK-${d.id}`;
      d.feeCents = Math.round(d.amountCents * 0.029) + 30;
      this.audit(
        c,
        d,
        'confirm',
        'payment-simulator',
        before,
        'Signed local mock event. Fee is an illustrative simulation (2.9% + $0.30), not a quoted processing price.',
      );
      this.afterConfirmation(c, d);
    } else if (d.status !== 'confirmed')
      fail('Payment already resolved and cannot be confirmed.', 409);
    this.state.events[event.id] = fingerprint;
    return this.receiptDonation(d);
  }
  uniqueTransaction(orgId, method, transaction, exceptId = null) {
    if (
      transaction &&
      this.state.ledger.some(
        (d) =>
          d.orgId === orgId &&
          d.method === method &&
          d.id !== exceptId &&
          d.status !== 'rejected' &&
          normalizedEmail(d.transaction) === normalizedEmail(transaction),
      )
    )
      fail('That transaction/reference already exists for this organization and method.', 409);
  }
  auditSnapshot(d) {
    const {
      id,
      reference,
      amountCents,
      feeCents,
      status,
      method,
      athleteId,
      receivedDate,
      transaction,
    } = d;
    return {
      id,
      reference,
      amountCents,
      feeCents,
      status,
      method,
      athleteId,
      receivedDate,
      transaction,
    };
  }
  audit(c, d, action, actor, before, note) {
    this.state.audit.push({
      id: id(),
      campaignId: c.id,
      at: c.now,
      actor,
      action,
      donationId: d.id,
      before,
      after: this.auditSnapshot(d),
      note,
    });
    this.log(c, `ledger-${action}`, `${d.reference}: ${action} recorded in audit trail.`);
  }
  afterConfirmation(c, d) {
    const contact = this.donationContact(c, d.email);
    for (const j of this.state.jobs.filter(
      (j) =>
        j.contactId === contact.id &&
        j.type === 'solicitation' &&
        ['queued', 'failed'].includes(j.status),
    )) {
      j.status = 'blocked';
      j.reason = 'Confirmed donation';
    }
    const key = `thankyou:${d.id}`;
    if (!this.state.jobs.some((j) => j.id === key))
      this.state.jobs.push({
        id: key,
        campaignId: c.id,
        contactId: contact.id,
        type: 'thank-you',
        donationId: d.id,
        reference: d.reference,
        dueDate: localDate(c.now, c.timezone),
        status: 'queued',
      });
  }
  reconcile(orgId, campaignId, donationId, input, actor) {
    const c = this.campaign(orgId, campaignId);
    const d =
      this.state.ledger.find((d) => d.id === donationId && d.campaignId === c.id) ||
      fail('Donation not found.', 404);
    return this.once(`ledger:${c.id}:${input.requestId}`, input, () => {
      if (!text(input.note)) fail('An audit note is required.');
      const before = this.auditSnapshot(d);
      if (['confirm', 'correct'].includes(input.action)) {
        if (
          (input.action === 'confirm' && d.status !== 'pending') ||
          (input.action === 'correct' && d.status !== 'confirmed')
        )
          fail('Donation is not in the required state.', 409);
        if (input.action === 'confirm' && d.method === 'stripe')
          fail('Use the signed mock payment event for Stripe confirmation.');
        if (input.method === 'stripe' && d.method !== 'stripe')
          fail('Stripe method can only be assigned by a signed mock payment event.');
        if (
          !['stripe', 'venmo', 'school', 'check'].includes(input.method) ||
          !dateValid(input.receivedDate) ||
          input.receivedDate > localDate(c.now, c.timezone)
        )
          fail('Method and received date (not in the future) are required.');
        const amountCents = money(input.amount);
        const feeCents =
          input.fee === '' || input.fee === undefined || input.fee === null
            ? null
            : money(input.fee, true);
        if (feeCents !== null && feeCents > amountCents)
          fail('Fees cannot exceed the donation amount.');
        const transaction = text(input.transaction, 200);
        this.uniqueTransaction(orgId, input.method, transaction, d.id);
        if (input.athleteId) this.findAthlete(c.id, input.athleteId);
        Object.assign(d, {
          amountCents,
          feeCents,
          transaction,
          method: input.method,
          receivedDate: input.receivedDate,
          status: 'confirmed',
          everConfirmed: true,
          ...(input.athleteId !== undefined ? { athleteId: input.athleteId || null } : {}),
        });
        this.afterConfirmation(c, d);
      } else if (input.action === 'reject') {
        if (d.status !== 'pending') fail('Only a pending payment can be rejected.', 409);
        d.status = 'rejected';
        this.skipOverdue(c);
        this.queueSequence(c, this.donationContact(c, d.email));
      } else if (input.action === 'refund') {
        if (d.status !== 'confirmed') fail('Only a confirmed donation can be refunded.', 409);
        d.status = 'refunded';
      } else if (input.action === 'attribute') {
        if (input.athleteId) this.findAthlete(c.id, input.athleteId);
        d.athleteId = input.athleteId || null;
      } else fail('Unknown ledger action.');
      this.audit(c, d, input.action, actor, before, text(input.note, 1000));
      return this.auditSnapshot(d);
    });
  }
  jobAction(orgId, campaignId, jobId, action) {
    const c = this.campaign(orgId, campaignId);
    const j =
      this.state.jobs.find((j) => j.id === jobId && j.campaignId === c.id) ||
      fail('Message not found.', 404);
    if (action === 'fail') {
      if (j.status !== 'queued') fail('Only queued messages can simulate failure.');
      j.status = 'failed';
      j.reason = 'Simulated delivery failure';
    } else if (action === 'retry') {
      if (j.status === 'sent') return;
      if (j.status !== 'failed') fail('Only failed messages can be retried.');
      const contact = this.state.contacts.find((x) => x.id === j.contactId);
      const suppression = this.state.suppressions.find(
        (s) => s.orgId === contact.orgId && s.email === contact.email,
      );
      if (
        (suppression && (j.type === 'solicitation' || suppression.reason !== 'unsubscribe')) ||
        (j.type === 'solicitation' &&
          (c.status === 'closed' || this.contactState(contact) === 'donated'))
      ) {
        j.status = 'blocked';
        j.reason = 'Recipient or campaign stopped';
      } else {
        j.status = 'queued';
        delete j.reason;
        this.run(c);
      }
    }
    this.log(c, `email-${action}`, `Simulated message ${action} recorded.`);
  }
  totals(campaignId, athleteId = undefined) {
    const ds = this.state.ledger.filter(
      (d) =>
        d.campaignId === campaignId &&
        d.status === 'confirmed' &&
        (athleteId === undefined || d.athleteId === athleteId),
    );
    return {
      grossCents: ds.reduce((sum, d) => sum + d.amountCents, 0),
      knownFeeCents: ds.reduce((sum, d) => sum + (d.feeCents ?? 0), 0),
      knownNetCents: ds
        .filter((d) => d.feeCents !== null)
        .reduce((sum, d) => sum + d.amountCents - d.feeCents, 0),
      unknownFeeCount: ds.filter((d) => d.feeCents === null).length,
      donationCount: ds.length,
    };
  }
  adminAthlete(a) {
    const { inviteHash, expiresAt, ...rest } = a;
    return { ...rest, totalCents: this.totals(a.campaignId, a.id).grossCents };
  }
  detail(orgId, campaignId, links = {}) {
    const c = this.campaign(orgId, campaignId);
    const athletes = this.state.athletes
      .filter((a) => a.campaignId === c.id)
      .map((a) => ({ ...this.adminAthlete(a), privatePath: links[a.id] || undefined }));
    return {
      ...c,
      athletes,
      contacts: this.state.contacts
        .filter((x) => x.campaignId === c.id)
        .map(({ publicToken, ...x }) => ({
          ...x,
          state: this.contactState({ ...x, publicToken }),
        })),
      ledger: this.state.ledger
        .filter((x) => x.campaignId === c.id)
        .map(({ receiptHash, ...x }) => x),
      jobs: this.state.jobs
        .filter((j) => j.campaignId === c.id)
        .map((j) => ({
          ...j,
          recipient: masked(this.state.contacts.find((x) => x.id === j.contactId).email),
          ...(j.preview || this.renderJob(c, j)),
        })),
      activity: this.state.activity
        .filter((x) => x.campaignId === c.id)
        .slice(-200)
        .reverse(),
      audit: this.state.audit
        .filter((x) => x.campaignId === c.id)
        .slice()
        .reverse(),
      totals: this.totals(c.id),
      teamTotals: [...new Set(athletes.map((a) => a.team))].map((team) => ({
        team,
        totalCents: athletes
          .filter((a) => a.team === team)
          .reduce((sum, a) => sum + a.totalCents, 0),
      })),
    };
  }
  publicView(slug, athleteId, contactToken) {
    const c = this.publicCampaign(slug);
    const {
      id,
      name,
      purpose,
      goalCents,
      startDate,
      endDate,
      timezone,
      color,
      logo,
      organizationName,
      status,
      paymentSettings,
    } = c;
    const athletes = this.state.athletes
      .filter((a) => a.campaignId === c.id)
      .map((a) => ({
        id: a.id,
        displayName: a.approved ? a.approvedProfile.displayName : a.displayName,
        team: a.team,
        photo: a.approved ? a.approvedProfile.photo : '',
        message: a.approved ? a.approvedProfile.message : '',
        totalCents: this.totals(c.id, a.id).grossCents,
      }));
    const athlete = athleteId
      ? athletes.find((a) => a.id === athleteId) || fail('Athlete page not found.', 404)
      : null;
    const contact = this.state.contacts.find(
      (x) => x.campaignId === c.id && safeEqual(x.publicToken, contactToken),
    );
    return {
      campaign: {
        id,
        name,
        slug,
        purpose,
        goalCents,
        startDate,
        endDate,
        timezone,
        color,
        logo: logo || '',
        organizationName,
        status,
        paymentSettings,
        receiptWording: this.organization(c.orgId).receiptWording,
      },
      athletes,
      athlete,
      totals: this.totals(c.id),
      associations: contact?.athleteIds || [],
      publicPath: athlete ? `/c/${slug}/a/${athlete.id}` : `/c/${slug}`,
    };
  }
}

export function parseAthleteCSV(csv) {
  if (typeof csv !== 'string' || csv.length > 200000) fail('CSV must be under 200 KB.');
  const rows = [];
  let row = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((s) => s.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (quoted) fail('CSV contains an unclosed quote.');
  row.push(cell);
  if (row.some((s) => s.trim())) rows.push(row);
  const headers = rows.shift()?.map((s) => s.trim().replace(/^\uFEFF/, '')) || [];
  if (
    !headers.includes('name') ||
    headers.some((s) => !['name', 'displayName', 'team'].includes(s)) ||
    new Set(headers).size !== headers.length
  )
    fail('Use CSV headers name,displayName,team (name required).');
  const errors = [];
  const athletes = rows.map((values, i) => {
    const a = Object.fromEntries(headers.map((h, j) => [h, values[j]?.trim() || '']));
    if (!a.name || a.name.length > 100 || values.length !== headers.length)
      errors.push({
        row: i + 2,
        error: 'Name required, maximum 100 characters; row must match header columns.',
      });
    return a;
  });
  if (athletes.length > 500) fail('Import at most 500 athletes per batch.');
  return { athletes, errors };
}

export function ledgerCSV(rows) {
  const keys = [
    'reference',
    'donorName',
    'email',
    'status',
    'method',
    'amount',
    'fee',
    'athleteId',
    'receivedDate',
    'transaction',
  ];
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[\s]*[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return [
    keys.join(','),
    ...rows.map((d) =>
      keys
        .map((k) =>
          cell(
            k === 'amount'
              ? (d.amountCents / 100).toFixed(2)
              : k === 'fee'
                ? d.feeCents === null
                  ? 'unknown'
                  : (d.feeCents / 100).toFixed(2)
                : d[k],
          ),
        )
        .join(','),
    ),
  ].join('\r\n');
}
