import { randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError, hash, token } from './domain.js';

const requireValue = (ok, message, status = 400) => {
  if (!ok) throw new AppError(message, status);
};
const cents = (value) => {
  requireValue(
    /^\d+(\.\d{1,2})?$/.test(String(value)),
    'Enter a nonnegative amount with at most two decimal places.',
  );
  const amount = Math.round(Number(value) * 100);
  requireValue(
    Number.isSafeInteger(amount) && amount <= 100000000,
    'Amount is outside the supported range.',
  );
  return amount;
};
const requiredText = (value, label) => {
  requireValue(
    typeof value === 'string' && value.trim().length > 0 && value.length <= 500,
    `${label} is required (up to 500 characters).`,
  );
  return value.trim();
};
const donations = (service, a) =>
  service.state.ledger.filter((d) => d.campaignId === a.campaignId && d.athleteId === a.id);
const sourceNet = (d) =>
  d.status === 'confirmed' && d.feeCents !== null && d.feeCents !== undefined
    ? Math.max(
        0,
        d.amountCents -
          (d.refundedCents || 0) -
          d.feeCents -
          (d.duesRedirectedCents || 0) -
          (d.disputeCents || 0),
      )
    : 0;
const entries = (a) => a.dues?.entries || [];
const applied = (a, donationId) =>
  entries(a)
    .filter((e) => !donationId || e.donationId === donationId)
    .reduce(
      (sum, e) =>
        sum + (e.type === 'credit' ? e.amountCents : e.type === 'reversal' ? -e.amountCents : 0),
      0,
    );
const payments = (a) =>
  entries(a).reduce(
    (sum, e) =>
      sum +
      (e.type === 'family-payment'
        ? e.amountCents
        : e.type === 'family-payment-reversal'
          ? -e.amountCents
          : 0),
    0,
  );
const effectiveTarget = (a, familyPaidCents) =>
  Math.min(a.dues.targetCents, Math.max(0, a.dues.chargesCents - familyPaidCents));
const append = (a, actor, type, amountCents, details = {}) => {
  const event = {
    id: randomUUID(),
    at: new Date().toISOString(),
    actor,
    type,
    amountCents,
    ...details,
  };
  a.dues.entries.push(event);
  return event;
};

// Account events live in the athlete's per-record data, preserved by all three
// existing transactional stores and complete backups. Nothing is auto-created
// in existing accounts; history is append-only through this module.
export function duesSummary(service, a, privateDetails = true) {
  if (!a.dues) return null;
  const ds = donations(service, a);
  const eligibleCents = ds.reduce((sum, d) => sum + sourceNet(d), 0);
  const appliedCents = applied(a);
  const familyPaidCents = payments(a);
  const remainingCents = Math.max(0, a.dues.chargesCents - familyPaidCents - appliedCents);
  const availableCents = ds.reduce(
    (sum, d) => sum + Math.max(0, sourceNet(d) - applied(a, d.id)),
    0,
  );
  const target = effectiveTarget(a, familyPaidCents);
  const s = {
    athleteId: a.id,
    name: a.name,
    season: a.dues.season,
    status: a.dues.status,
    version: entries(a).length,
    chargesCents: a.dues.chargesCents,
    targetCents: a.dues.targetCents,
    grossCents: ds
      .filter((d) => d.status === 'confirmed')
      .reduce((sum, d) => sum + d.amountCents - (d.refundedCents || 0), 0),
    knownFeeCents: ds.filter((d) => d.everConfirmed).reduce((sum, d) => sum + (d.feeCents || 0), 0),
    pendingCents: ds
      .filter((d) => d.status === 'pending')
      .reduce((sum, d) => sum + d.amountCents, 0),
    unknownFeeCount: ds.filter((d) => d.status === 'confirmed' && d.feeCents === null).length,
    awaitingFeeCents: ds
      .filter((d) => d.status === 'confirmed' && d.feeCents === null)
      .reduce((sum, d) => sum + d.amountCents - (d.refundedCents || 0), 0),
    refundedCents: ds.reduce((sum, d) => sum + (d.refundedCents || 0), 0),
    redirectedCents: ds.reduce((sum, d) => sum + (d.duesRedirectedCents || 0), 0),
    eligibleCents,
    appliedCents,
    familyPaidCents,
    remainingCents,
    availableCents,
    excessCents: Math.max(0, availableCents - remainingCents),
    familyOverpaymentCents: Math.max(0, familyPaidCents - a.dues.chargesCents),
    disputedCents: ds.reduce((sum, d) => sum + (d.disputeCents || 0), 0),
    awaitingReversalCents: entries(a)
      .filter(
        (e) =>
          e.type === 'reversal' &&
          !entries(a).some((ack) => ack.type === 'reversal-posted' && ack.reversalId === e.id),
      )
      .reduce((sum, e) => sum + e.amountCents, 0),
    fundraisingOpen:
      a.dues.status === 'active' &&
      !a.dues.fundraisingClosed &&
      target > 0 &&
      eligibleCents < target,
    asOf: new Date().toISOString(),
  };
  if (privateDetails) {
    s.entries = structuredClone(entries(a));
    s.sources = ds.map((d) => ({
      id: d.id,
      reference: d.reference,
      status: d.status,
      amountCents: d.amountCents,
      feeCents: d.feeCents,
      refundedCents: d.refundedCents || 0,
      disputeCents: d.disputeCents || 0,
      redirectedCents: d.duesRedirectedCents || 0,
      eligibleCents: sourceNet(d),
      appliedCents: applied(a, d.id),
      availableCents: Math.max(0, sourceNet(d) - applied(a, d.id)),
    }));
  }
  return s;
}

export function fundraisingOpen(service, a) {
  return !a.dues || duesSummary(service, a, false).fundraisingOpen;
}

export function synchronizeDues(service, a, actor, reason) {
  if (!a.dues) return;
  const target = effectiveTarget(a, payments(a));
  if (
    a.dues.status !== 'active' ||
    target === 0 ||
    donations(service, a).reduce((sum, d) => sum + sourceNet(d), 0) >= target
  )
    a.dues.fundraisingClosed = true;
  // Reverse the newest posting first, preserving every original posting.
  const reverse = (donationId, amount) => {
    for (const credit of [...entries(a)]
      .reverse()
      .filter((e) => e.type === 'credit' && (!donationId || e.donationId === donationId))) {
      const reversed = entries(a)
        .filter((e) => e.type === 'reversal' && e.creditId === credit.id)
        .reduce((s, e) => s + e.amountCents, 0);
      const take = Math.min(amount, credit.amountCents - reversed);
      if (take > 0)
        append(a, actor, 'reversal', take, {
          donationId: credit.donationId,
          creditId: credit.id,
          note: reason,
        });
      amount -= take;
      if (!amount) break;
    }
  };
  for (const donationId of new Set(
    entries(a)
      .filter((e) => e.type === 'credit')
      .map((e) => e.donationId),
  )) {
    const d = donations(service, a).find((d) => d.id === donationId);
    reverse(
      donationId,
      Math.max(0, applied(a, donationId) - (d ? sourceNet({ ...d, disputeCents: 0 }) : 0)),
    );
  }
  reverse(null, Math.max(0, applied(a) + payments(a) - a.dues.chargesCents));
}

export function changeDues(service, orgId, campaignId, athleteId, input, actor) {
  const c = service.campaign(orgId, campaignId);
  requireValue(
    orgId === 'tvvc',
    'Dues credits require separate school approval for this organization.',
    403,
  );
  const a = service.findAthlete(c.id, athleteId);
  return service.once(`dues:${c.id}:${a.id}:${input.requestId}`, input, () => {
    requireValue(
      input.version === entries(a).length,
      'This account changed. Refresh before trying again.',
      409,
    );
    const note = requiredText(input.note, 'Audit note');
    if (input.action === 'setup') {
      requireValue(!a.dues, 'This player already has a season account.', 409);
      const chargesCents = cents(input.charges),
        targetCents = cents(input.target);
      requireValue(targetCents <= chargesCents, 'Target cannot exceed eligible season charges.');
      a.dues = {
        season: requiredText(input.season, 'Season'),
        chargesCents,
        targetCents,
        status: 'active',
        entries: [],
      };
      append(a, actor, 'setup', chargesCents, { targetCents, note });
    } else {
      requireValue(a.dues, 'Set up a season account first.', 409);
      const summary = duesSummary(service, a);
      const d = input.donationId
        ? donations(service, a).find((d) => d.id === input.donationId)
        : null;
      if (input.action === 'family-payment') {
        const amount = cents(input.amount);
        requireValue(amount > 0, 'Payment must be positive.');
        const reference = requiredText(input.reference, 'External payment reference');
        uniqueReference(service, c.orgId, reference);
        append(a, actor, 'family-payment', amount, { reference, note });
      } else if (input.action === 'reverse-family-payment') {
        const payment = entries(a).find(
          (e) => e.type === 'family-payment' && e.id === input.paymentId,
        );
        const reversed = entries(a)
          .filter((e) => e.type === 'family-payment-reversal' && e.paymentId === input.paymentId)
          .reduce((sum, e) => sum + e.amountCents, 0);
        const amount = cents(input.amount);
        requireValue(
          payment && amount > 0 && amount <= payment.amountCents - reversed,
          'Choose a family payment and an unreversed amount.',
          409,
        );
        const reference = requiredText(
          input.reference,
          'External family payment reversal reference',
        );
        uniqueReference(service, c.orgId, reference);
        append(a, actor, 'family-payment-reversal', amount, {
          paymentId: payment.id,
          reference,
          note,
        });
      } else if (input.action === 'post' || input.action === 'withdrawal-post') {
        requireValue(
          input.action === 'withdrawal-post'
            ? a.dues.status === 'withdrawn'
            : a.dues.status === 'active',
          'Withdrawn accounts require an explicit remaining-obligation posting.',
          409,
        );
        requireValue(d, 'Choose a contribution belonging to this player.', 404);
        requireValue(
          summary.awaitingReversalCents === 0,
          'Reconcile outstanding external reversals before posting more credit.',
          409,
        );
        const amount = cents(input.amount);
        requireValue(
          amount > 0 &&
            amount <= summary.remainingCents &&
            amount <= sourceNet(d) - applied(a, d.id),
          'Credit exceeds available confirmed net funds or outstanding dues.',
          409,
        );
        const reference = requiredText(input.reference, 'External credit posting reference');
        uniqueReference(service, c.orgId, reference);
        append(a, actor, 'credit', amount, { donationId: d.id, reference, note });
      } else if (input.action === 'withdraw') {
        requireValue(a.dues.status === 'active', 'Account is already withdrawn.', 409);
        a.dues.chargesCents = cents(input.charges);
        a.dues.status = 'withdrawn';
        append(a, actor, 'withdraw', a.dues.chargesCents, { note });
        a.dues.summaryHash = null;
      } else if (input.action === 'obligation') {
        const amount = cents(input.charges),
          target = cents(input.target);
        requireValue(target <= amount, 'Target cannot exceed eligible season charges.');
        a.dues.chargesCents = amount;
        a.dues.targetCents = target;
        append(a, actor, 'obligation', amount, { targetCents: target, note });
      } else if (input.action === 'resume-fundraising') {
        requireValue(
          a.dues.status === 'active' &&
            summary.remainingCents > 0 &&
            summary.awaitingReversalCents === 0,
          'Reconcile an active account with outstanding dues before reopening.',
          409,
        );
        requireValue(
          summary.eligibleCents < effectiveTarget(a, summary.familyPaidCents),
          'The approved fundraising target is already covered or is zero.',
          409,
        );
        a.dues.fundraisingClosed = false;
        append(a, actor, 'resume-fundraising', 0, { note });
      } else if (input.action === 'reversal-posted') {
        const reversal = entries(a).find((e) => e.type === 'reversal' && e.id === input.reversalId);
        requireValue(
          reversal &&
            !entries(a).some((e) => e.type === 'reversal-posted' && e.reversalId === reversal.id),
          'Choose an outstanding reversal.',
          409,
        );
        const reference = requiredText(input.reference, 'External reversal reference');
        uniqueReference(service, c.orgId, reference);
        append(a, actor, 'reversal-posted', reversal.amountCents, {
          reversalId: reversal.id,
          reference,
          note,
        });
      } else if (input.action === 'family-link') {
        const raw = token();
        a.dues.summaryHash = hash(raw);
        a.dues.summaryExpiresAt = new Date(Date.now() + 8 * 3600000).toISOString();
        append(a, actor, 'family-link', 0, { note });
        return { privatePath: `/family/${raw}` };
      } else if (input.action === 'revoke-link') {
        a.dues.summaryHash = null;
        append(a, actor, 'revoke-link', 0, { note });
      } else if (input.action === 'rehearsal-confirm' || input.action === 'fee') {
        requireValue(
          c.duesRehearsal && d?.rehearsal,
          'This action is only available for generated fictional contributions.',
          403,
        );
        requireValue(
          input.action === 'fee' ? d.status === 'confirmed' : d.status === 'pending',
          'Contribution is not in the required state.',
          409,
        );
        const fee = cents(input.amount);
        requireValue(fee <= d.amountCents, 'Fees cannot exceed the contribution.');
        requireValue(
          !d.duesRedirectedCents ||
            fee <= d.amountCents - (d.refundedCents || 0) - d.duesRedirectedCents,
          'Reverse redirected funds before increasing fees beyond remaining funds.',
          409,
        );
        const before = service.auditSnapshot(d);
        d.status = 'confirmed';
        d.everConfirmed = true;
        d.feeCents = fee;
        d.receivedDate = c.now.slice(0, 10);
        append(a, actor, input.action, fee, { donationId: d.id, note });
        service.audit(c, d, `dues-${input.action}`, actor, before, note);
      } else if (
        ['refund', 'redirect', 'undo-redirect', 'dispute', 'dispute-won', 'dispute-lost'].includes(
          input.action,
        )
      ) {
        requireValue(
          d && d.status === 'confirmed',
          'Choose a confirmed contribution belonging to this player.',
          409,
        );
        const before = service.auditSnapshot(d);
        if (input.action === 'refund') {
          const amount = cents(input.amount);
          requireValue(
            amount > 0 && amount <= d.amountCents - (d.refundedCents || 0),
            'Refund exceeds the remaining donor payment.',
          );
          requireValue(
            !d.disputeCents && !d.duesRedirectedCents,
            'Resolve dispute or redirected funds before refunding.',
            409,
          );
          const reference = requiredText(input.reference, 'Simulated donor refund reference');
          uniqueReference(service, c.orgId, reference);
          d.refundedCents = (d.refundedCents || 0) + amount;
          if (d.refundedCents === d.amountCents) d.status = 'refunded';
          append(a, actor, 'refund', amount, { donationId: d.id, reference, note });
        } else if (input.action === 'redirect') {
          const amount = cents(input.amount);
          requireValue(
            !d.disputeCents &&
              amount > 0 &&
              amount <= sourceNet(d) - applied(a, d.id) &&
              amount <= summary.excessCents,
            'Only unapplied excess may be redirected.',
            409,
          );
          const consent = requiredText(input.consent, 'Affirmative donor consent evidence');
          d.duesRedirectedCents = (d.duesRedirectedCents || 0) + amount;
          append(a, actor, 'redirect', amount, { donationId: d.id, consent, note });
        } else if (input.action === 'undo-redirect') {
          const amount = cents(input.amount);
          requireValue(
            amount > 0 && amount <= (d.duesRedirectedCents || 0),
            'Amount exceeds existing redirected funds.',
            409,
          );
          const consent = requiredText(input.consent, 'Donor/owner reversal evidence');
          d.duesRedirectedCents -= amount;
          append(a, actor, 'undo-redirect', amount, { donationId: d.id, consent, note });
        } else if (input.action === 'dispute') {
          const amount = cents(input.amount);
          requireValue(
            !d.disputeCents &&
              !d.duesRedirectedCents &&
              amount > 0 &&
              amount <= d.amountCents - (d.refundedCents || 0),
            'Invalid dispute amount or unresolved dispute.',
            409,
          );
          d.disputeCents = amount;
          append(a, actor, 'dispute', amount, { donationId: d.id, note });
        } else {
          requireValue(d.disputeCents > 0, 'No open dispute.', 409);
          const amount = d.disputeCents;
          if (input.action === 'dispute-lost') {
            d.refundedCents = (d.refundedCents || 0) + amount;
            if (d.refundedCents === d.amountCents) d.status = 'refunded';
          }
          d.disputeCents = 0;
          append(a, actor, input.action, amount, { donationId: d.id, note });
        }
        service.audit(c, d, `dues-${input.action}`, actor, before, note);
      } else throw new AppError('Unknown dues action.');
    }
    synchronizeDues(service, a, actor, note);
    service.log(
      c,
      'dues-updated',
      'Fictional season dues account updated; no money moved or email sent.',
    );
    return { success: true };
  });
}

function uniqueReference(service, orgId, reference) {
  requireValue(
    !service.state.ledger.some(
      (d) => d.orgId === orgId && d.transaction?.trim().toLowerCase() === reference.toLowerCase(),
    ),
    'That reference is already recorded as a donor payment.',
    409,
  );
  requireValue(
    !service.state.athletes.some(
      (a) =>
        a.orgId === orgId &&
        entries(a).some((e) => e.reference?.toLowerCase() === reference.toLowerCase()),
    ),
    'That external posting reference has already been recorded.',
    409,
  );
}

export function familySummary(service, raw) {
  const digest = hash(raw);
  const a = service.state.athletes.find((a) => {
    const stored = a.dues?.summaryHash;
    return (
      stored &&
      stored.length === digest.length &&
      timingSafeEqual(Buffer.from(stored), Buffer.from(digest)) &&
      Date.parse(a.dues.summaryExpiresAt) > Date.now()
    );
  });
  requireValue(a, 'This private family summary link expired or was revoked.', 404);
  return { ...duesSummary(service, a, false), name: a.displayName, simulation: true };
}

export function duesExport(service, orgId, campaignId) {
  service.campaign(orgId, campaignId);
  // Stable event IDs and explicit types distinguish postings from their receipts.
  const rows = service.state.athletes
    .filter((a) => a.campaignId === campaignId && a.dues)
    .flatMap((a) =>
      entries(a)
        .filter((e) =>
          [
            'credit',
            'reversal',
            'reversal-posted',
            'family-payment',
            'family-payment-reversal',
          ].includes(e.type),
        )
        .map((e) => ({
          entryId: e.id,
          season: a.dues.season,
          type: e.type,
          donationId: e.donationId,
          amountCents: ['reversal', 'family-payment-reversal'].includes(e.type)
            ? -e.amountCents
            : e.amountCents,
          athleteId: a.id,
          at: e.at,
          reference: e.reference || 'Awaiting external reversal',
          actor: e.actor,
          note: e.note,
        })),
    );
  const cell = (value) => {
    let text = String(value ?? '');
    if (typeof value !== 'number' && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const keys = [
    'entryId',
    'athleteId',
    'season',
    'type',
    'donationId',
    'amountCents',
    'reference',
    'at',
    'actor',
    'note',
  ];
  return [keys.join(','), ...rows.map((row) => keys.map((key) => cell(row[key])).join(','))].join(
    '\r\n',
  );
}

export function createDuesRehearsal(service, orgId, input, actor, pilot) {
  requireValue(orgId === 'tvvc', 'TVVC only.', 403);
  return service.once(`dues-rehearsal:${orgId}:${input.requestId}`, input, () => {
    const c = service.createCampaign(orgId, {
      name: 'Fictional Girls Club dues rehearsal',
      purpose:
        'Fictional families raising money toward their season dues. No money moves and no email is sent.',
      goal: '2000',
    });
    c.duesRehearsal = true;
    if (pilot) for (const method of Object.values(c.paymentSettings)) method.enabled = false;
    for (const name of ['Sample Riley', 'Sample Morgan']) {
      const { athlete } = service.addAthlete(orgId, c.id, { name, team: 'Fictional Girls Club' });
      const a = service.findAthlete(c.id, athlete.id);
      // No setup links are issued to families by this rehearsal.
      a.inviteHash = null;
      a.invitationStatus = 'revoked';
      a.dues = {
        season: 'Fictional Girls Club season',
        chargesCents: 100000,
        targetCents: 100000,
        status: 'active',
        entries: [],
      };
      append(a, actor, 'setup', 100000, {
        note: 'Synthetic rehearsal account; not a real family.',
      });
      for (const [amountCents, feeCents, status] of [
        [10000, 300, 'confirmed'],
        [5000, null, 'confirmed'],
        [2500, null, 'pending'],
      ]) {
        const donation = {
          id: randomUUID(),
          orgId,
          campaignId: c.id,
          athleteId: a.id,
          reference: `DEMO-${randomUUID()}`,
          email: 'fictional-donor@example.test',
          donorName: 'Fictional donor',
          amountCents,
          feeCents,
          status,
          method: 'venmo',
          reported: true,
          everConfirmed: status === 'confirmed',
          transaction: '',
          receivedDate: status === 'confirmed' ? c.now.slice(0, 10) : null,
          createdAt: c.now,
          receiptHash: hash(token()),
          rehearsal: true,
        };
        service.state.ledger.push(donation);
      }
    }
    return { campaignId: c.id };
  });
}
