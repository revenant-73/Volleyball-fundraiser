import React, { useState } from 'react';

const money = (cents) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);
function Balances({ summary: s }) {
  return (
    <>
      <p>
        {s.season} · {s.status} · as of {new Date(s.asOf).toLocaleString()}
      </p>
      <dl className="dues-balances">
        {[
          ['Eligible season charges', s.chargesCents],
          ['Family direct payments', s.familyPaidCents],
          ['Confirmed gross after refunds', s.grossCents],
          ['Known processing fees', s.knownFeeCents],
          ['Gross awaiting fee reconciliation', s.awaitingFeeCents],
          ['Refunds / lost disputes', s.refundedCents],
          ['Redirected to general club support', s.redirectedCents],
          ['Pending contributions', s.pendingCents],
          ['Available net funds', s.availableCents],
          ['Applied dues credit', s.appliedCents],
          ['Remaining dues', s.remainingCents],
          ['Unapplied excess', s.excessCents],
          ['Disputed funds', s.disputedCents],
          ['External reversals awaiting reconciliation', s.awaitingReversalCents],
          ['Family overpayment for owner review', s.familyOverpaymentCents],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{money(value)}</dd>
          </div>
        ))}
      </dl>
      <p>
        {s.unknownFeeCount} contribution(s) awaiting fee reconciliation. Target:{' '}
        {money(s.targetCents)}. Player fundraising:{' '}
        {s.fundraisingOpen ? 'open in simulation' : 'stopped'}.
      </p>
    </>
  );
}

export function FamilyDuesSummary({ token, api, Notice }) {
  const [state, setState] = useState({ loading: true });
  React.useEffect(() => {
    let active = true;
    api(`/api/family/${encodeURIComponent(token)}`)
      .then((data) => {
        if (active) setState({ data });
      })
      .catch((e) => {
        if (active) setState({ error: e.message });
      });
    return () => {
      active = false;
    };
  }, [token, api]);
  return (
    <main className="narrow">
      <h1>Private family season summary</h1>
      <Notice>
        Fictional rehearsal only. No actual dues account or payment has changed. This read-only link
        expires after eight hours.
      </Notice>
      {state.error && <Notice kind="error">{state.error}</Notice>}
      {state.loading && <p>Loading season summary…</p>}
      {state.data && (
        <>
          <h2>{state.data.name}</h2>
          <Balances summary={state.data} />
        </>
      )}
    </main>
  );
}

export function DuesWorkspace({
  campaign,
  base,
  busy,
  mutate,
  onRehearsal,
  Field,
  Notice,
  pilot,
  owner,
}) {
  const [selected, setSelected] = useState('');
  const athletes = campaign?.athletes || [];
  const athlete = athletes.find((a) => a.id === selected) || athletes[0];
  return (
    <section className="dues-workspace">
      <Notice>
        Fictional dues rehearsal. Credits record manual posting evidence; they do not change TVVC
        billing, move money, or send email. Refunds and dispute resolutions here are simulations.
      </Notice>
      <p>
        Help individual families cover season dues. Club and team totals summarize their efforts.
      </p>
      {owner && (
        <button className="secondary" disabled={busy} onClick={onRehearsal}>
          Create fictional dues rehearsal
        </button>
      )}
      {!owner && (
        <Notice>
          Owners operate the dues rehearsal. Administrators can review the account summaries.
        </Notice>
      )}
      {campaign && <p>{campaign.name}</p>}
      {athlete ? (
        <>
          <Field label="Player dues account">
            <select value={athlete.id} onChange={(e) => setSelected(e.target.value)}>
              {athletes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          {pilot && !campaign.duesRehearsal ? (
            <Notice>Create a fictional rehearsal campaign to exercise credits in the pilot.</Notice>
          ) : (
            <DuesAccount
              key={athlete.id}
              athlete={athlete}
              base={base}
              busy={busy}
              mutate={mutate}
              Field={Field}
              Notice={Notice}
              owner={owner}
              rehearsal={campaign.duesRehearsal}
            />
          )}
          {owner && (
            <p>
              <a href={`${base}/dues-export`} download>
                Download dues posting history CSV
              </a>
            </p>
          )}
        </>
      ) : (
        <p>
          Create a fictional rehearsal to review accounts, contributions, credits, excess funds and
          withdrawals.
        </p>
      )}
    </section>
  );
}

function DuesAccount({ athlete, base, busy, mutate, Field, Notice, owner, rehearsal }) {
  const s = athlete.dues;
  const [form, setForm] = useState({
    action: 'post',
    amount: '',
    reference: '',
    note: '',
    season: 'Fictional Girls Club season',
    charges: '',
    target: '',
    donationId: '',
    reversalId: '',
    paymentId: '',
    consent: '',
  });
  const [familyLink, setFamilyLink] = useState('');
  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const action = s ? form.action : 'setup';
  const sourceActions = [
    'post',
    'withdrawal-post',
    'refund',
    'redirect',
    'undo-redirect',
    'dispute',
    'dispute-won',
    'dispute-lost',
    'fee',
    'rehearsal-confirm',
  ];
  const moneyActions = [
    'post',
    'withdrawal-post',
    'family-payment',
    'reverse-family-payment',
    'refund',
    'redirect',
    'undo-redirect',
    'dispute',
    'fee',
    'rehearsal-confirm',
  ];
  const referenceActions = [
    'post',
    'withdrawal-post',
    'family-payment',
    'reverse-family-payment',
    'refund',
    'reversal-posted',
  ];
  async function submit(e) {
    e.preventDefault();
    const result = await mutate(
      `${base}/dues/${athlete.id}`,
      'POST',
      { ...form, action, version: s?.version || 0, requestId: crypto.randomUUID() },
      'Fictional dues account updated.',
    );
    if (result) {
      if (result.privatePath) setFamilyLink(result.privatePath);
      if (['withdraw', 'revoke-link'].includes(action)) setFamilyLink('');
      setForm((f) => ({ ...f, amount: '', reference: '', note: '', consent: '' }));
    }
  }
  return (
    <article className="panel dues-account">
      <h2>{athlete.name} · season dues</h2>
      {s ? (
        <Balances summary={s} />
      ) : (
        <p>No dues account yet. Enter fictional season charges and a fundraising target.</p>
      )}
      {owner && (
        <form onSubmit={submit}>
          {s && (
            <Field label="Dues action">
              <select value={form.action} onChange={update('action')}>
                <option value="post">Record reconciled credit posting</option>
                <option value="withdrawal-post">
                  Apply credit to reviewed withdrawal obligation
                </option>
                <option value="family-payment">Record family direct payment</option>
                <option value="reverse-family-payment">
                  Reverse a family direct payment record
                </option>
                <option value="obligation">Update eligible charges and target</option>
                <option value="resume-fundraising">
                  Reopen player fundraising after owner review
                </option>
                <option value="withdraw">Withdraw family / cancel season</option>
                <option value="refund">Simulate donor refund</option>
                <option value="redirect">Redirect excess with donor consent</option>
                <option value="undo-redirect">Reverse redirection before donor refund</option>
                <option value="dispute">Place dispute hold</option>
                <option value="dispute-won">Resolve dispute won</option>
                <option value="dispute-lost">Resolve dispute lost</option>
                <option value="reversal-posted">Reconcile external credit reversal</option>
                <option value="family-link">Issue / replace private family summary link</option>
                <option value="revoke-link">Revoke family summary link</option>
                {rehearsal && (
                  <>
                    <option value="fee">Reconcile fictional contribution fee</option>
                    <option value="rehearsal-confirm">
                      Confirm fictional pending contribution
                    </option>
                  </>
                )}
              </select>
            </Field>
          )}
          {action === 'setup' && (
            <Field label="Season" value={form.season} onChange={update('season')} required />
          )}
          {['setup', 'obligation', 'withdraw'].includes(action) && (
            <Field
              label={
                action === 'withdraw'
                  ? 'Total eligible season obligation after withdrawal ($)'
                  : 'Eligible season charges ($)'
              }
              type="number"
              min="0"
              step="0.01"
              value={form.charges}
              onChange={update('charges')}
              required
            />
          )}
          {['setup', 'obligation'].includes(action) && (
            <Field
              label="Approved fundraising target ($)"
              type="number"
              min="0"
              step="0.01"
              value={form.target}
              onChange={update('target')}
              required
            />
          )}
          {sourceActions.includes(action) && (
            <Field label="Contribution">
              <select required value={form.donationId} onChange={update('donationId')}>
                <option value="">Choose a contribution</option>
                {(s?.sources || []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.reference} · {d.status} · fee{' '}
                    {d.feeCents === null ? 'unknown' : money(d.feeCents)} · available{' '}
                    {money(d.availableCents)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {action === 'reversal-posted' && (
            <Field label="Outstanding reversal">
              <select required value={form.reversalId} onChange={update('reversalId')}>
                <option value="">Choose a reversal</option>
                {s.entries
                  .filter(
                    (e) =>
                      e.type === 'reversal' &&
                      !s.entries.some(
                        (ack) => ack.type === 'reversal-posted' && ack.reversalId === e.id,
                      ),
                  )
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.id} · {money(e.amountCents)}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          {action === 'reverse-family-payment' && (
            <Field label="Family payment to reverse">
              <select required value={form.paymentId} onChange={update('paymentId')}>
                <option value="">Choose a family payment</option>
                {s.entries
                  .filter((e) => e.type === 'family-payment')
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.reference} · {money(e.amountCents)}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          {moneyActions.includes(action) && (
            <Field
              label={
                action === 'fee' || action === 'rehearsal-confirm'
                  ? 'Verified processing fee ($)'
                  : 'Amount ($)'
              }
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={update('amount')}
              required
            />
          )}
          {referenceActions.includes(action) && (
            <Field
              label="External posting / payment / refund reference"
              value={form.reference}
              onChange={update('reference')}
              required
            />
          )}
          {['redirect', 'undo-redirect'].includes(action) && (
            <Field
              label="Affirmative donor consent evidence"
              value={form.consent}
              onChange={update('consent')}
              required
            />
          )}
          <Field label="Dues audit note" value={form.note} onChange={update('note')} required />
          <button disabled={busy}>{s ? 'Save dues action' : 'Create season account'}</button>
        </form>
      )}
      {familyLink && (
        <Notice>
          <a href={familyLink} target="_blank" rel="noreferrer">
            Open private family summary
          </a>{' '}
          · Deliver only to the verified guardian through an established channel. No email is sent.
        </Notice>
      )}
      {s && (
        <details>
          <summary>Contribution detail</summary>
          <ul>
            {s.sources.map((d) => (
              <li key={d.id}>
                {d.reference}: {d.status}; gross {money(d.amountCents)}; refunded{' '}
                {money(d.refundedCents)}; eligible {money(d.eligibleCents)}; applied{' '}
                {money(d.appliedCents)}; redirected {money(d.redirectedCents)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {s && (
        <details>
          <summary>Dues audit history</summary>
          <ul>
            {[...s.entries].reverse().map((e) => (
              <li key={e.id}>
                {new Date(e.at).toLocaleString()} · {e.type} · {money(e.amountCents)} ·{' '}
                {e.reference || '—'} · {e.note}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
