import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

const money = (value) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format((value || 0) / 100);
const methodNames = {
  stripe: 'Card · simulated Stripe',
  venmo: 'Venmo Business',
  school: 'School payment portal',
  check: 'Mailed check',
};
const pathUrl = (path) => new URL(path, window.location.origin).href;
const date = (value) =>
  value ? (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value).toLocaleString()) : '—';
// Keep unresolved idempotent mutations in memory only. A lost response may have
// committed on the server, so a retry must retain the original request ID.
const pendingRequests = new Map();
async function api(path, method = 'GET', body) {
  let key;
  let payload = body;
  if (body && typeof body === 'object' && body.requestId) {
    const { requestId, ...content } = body;
    key = `${method} ${path} ${JSON.stringify(content)}`;
    if (!pendingRequests.has(key)) pendingRequests.set(key, requestId);
    payload = { ...content, requestId: pendingRequests.get(key) };
  }
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Prototype': 'local' },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });
  if (key && response.status >= 400 && response.status < 500) pendingRequests.delete(key);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  if (key) pendingRequests.delete(key);
  return data;
}
function Link({ href, children, ...props }) {
  return (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        if (!event.ctrlKey && !event.metaKey && props.target !== '_blank' && href.startsWith('/')) {
          event.preventDefault();
          history.pushState({}, '', href);
          window.dispatchEvent(new PopStateEvent('popstate'));
          window.scrollTo(0, 0);
        }
      }}
    >
      {children}
    </a>
  );
}
function Field({ label, children, hint, ...props }) {
  return (
    <div className="field">
      <label>
        <span>{label}</span>
        {children || <input {...props} />}
      </label>
      {hint && <small>{hint}</small>}
    </div>
  );
}
function Status({ value }) {
  return (
    <span className={`status status-${value}`}>
      {String(value || 'pending').replaceAll('_', ' ')}
    </span>
  );
}
function Notice({ children, kind = 'info' }) {
  return children ? (
    <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  ) : null;
}
function Empty({ children }) {
  return <p className="empty">{children}</p>;
}
function Progress({ total, goal }) {
  const percent = goal > 0 ? Math.min(100, (total / goal) * 100) : 0;
  return (
    <div className="progress-block">
      <div className="progress-caption">
        <strong>
          {money(total)} <span>raised</span>
        </strong>
        <span>of {money(goal)}</span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label="Confirmed campaign fundraising"
        aria-valuenow={Math.round(percent)}
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <i style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
function useResource(path) {
  const [data, setData] = useState(null),
    [error, setError] = useState('');
  const refresh = async () => {
    if (!path) return;
    try {
      setError('');
      setData(await api(path));
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    setData(null);
    refresh();
  }, [path]);
  return { data, setData, error, refresh };
}
function Share({ path, title, organization }) {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const url = pathUrl(path);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Public link copied.');
    } catch {
      setMessage('Copy the public link from the field below.');
    }
  }
  async function nativeShare() {
    try {
      await navigator.share({ title, text: `Support ${organization || title}`, url });
    } catch (e) {
      if (e.name !== 'AbortError') setMessage('Sharing is unavailable. Copy the link instead.');
    }
  }
  async function graphic() {
    setBusy(true);
    try {
      const qr = await QRCode.toDataURL(url, { width: 450, margin: 2, errorCorrectionLevel: 'M' });
      const picture = new Image();
      picture.src = qr;
      await picture.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1350;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#101f29';
      ctx.fillRect(0, 0, 1080, 1350);
      ctx.strokeStyle = '#2a444f';
      ctx.lineWidth = 4;
      ctx.strokeRect(55, 55, 970, 1240);
      ctx.beginPath();
      ctx.moveTo(55, 540);
      ctx.lineTo(1025, 540);
      ctx.stroke();
      ctx.fillStyle = '#5ce1bc';
      ctx.font = 'bold 30px sans-serif';
      ctx.fillText('RALLY FUND • VOLLEYBALL', 90, 145);
      ctx.fillStyle = '#f6f3e9';
      ctx.font = 'bold 64px sans-serif';
      const words = title.split(' ');
      let line = '',
        y = 260;
      for (const word of words) {
        if (ctx.measureText(`${line}${word} `).width > 890) {
          ctx.fillText(line, 90, y);
          line = '';
          y += 78;
        }
        line += `${word} `;
      }
      ctx.fillText(line, 90, y);
      ctx.font = '30px sans-serif';
      ctx.fillText((organization || 'Support our team').slice(0, 58), 90, 460);
      ctx.drawImage(picture, 315, 610, 450, 450);
      ctx.font = 'bold 38px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SCAN TO SUPPORT', 540, 1140);
      ctx.font = '22px sans-serif';
      ctx.fillText('Prototype · payments and emails are simulated', 540, 1220);
      const link = document.createElement('a');
      link.download = 'rally-fund-instagram.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      setMessage('Graphic downloaded. Post it to Instagram yourself; QR opens this public page.');
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="share-box">
      <h3>Pass it on.</h3>
      <p>Share the public page with your community.</p>
      <input
        aria-label="Public fundraising URL"
        readOnly
        value={url}
        onFocus={(e) => e.target.select()}
      />
      <div className="button-row">
        <button className="secondary" onClick={copy}>
          Copy link
        </button>
        {navigator.share && (
          <button className="secondary" onClick={nativeShare}>
            Share…
          </button>
        )}
        <a
          className="button secondary"
          href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noreferrer"
        >
          Facebook
        </a>
        <button className="secondary" disabled={busy} onClick={graphic}>
          {busy ? 'Creating…' : 'Instagram QR graphic ↓'}
        </button>
      </div>
      <Notice>{message}</Notice>
    </section>
  );
}
function Login({ onLogin }) {
  const { data: runtime } = useResource('/api/runtime');
  const [email, setEmail] = useState('coach@tvvc.example'),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (runtime?.mode === 'pilot') {
      setEmail('');
      setPassword('');
    } else if (runtime && !runtime.hosted) setPassword('prototype-only');
  }, [runtime?.hosted, runtime?.mode]);
  return (
    <form
      className="login-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const result = await api('/api/login', 'POST', { email, password });
          onLogin(result);
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Coach’s corner</h2>
      <p>
        {runtime?.mode === 'pilot'
          ? 'Sign in with your individual administrator account.'
          : 'Sign in to review the complete administrator flow.'}
      </p>
      {runtime?.mode === 'pilot' ? (
        <Field
          label="Administrator email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      ) : (
        <Field label="Demo organization">
          <select value={email} onChange={(e) => setEmail(e.target.value)}>
            <option value="coach@tvvc.example">TVVC · coach@tvvc.example</option>
            <option value="coach@century.example">Century · coach@century.example</option>
          </select>
        </Field>
      )}
      <Field
        label={
          runtime?.mode === 'pilot'
            ? 'Password'
            : runtime?.hosted
              ? 'Review password'
              : 'Demo password'
        }
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <small>
        {runtime?.mode === 'pilot'
          ? 'Need account recovery? Contact the organization owner. Email recovery is not enabled.'
          : runtime?.hosted
            ? 'Use the private review password supplied by the project owner.'
            : 'Local demo password: prototype-only'}
      </small>
      <Notice kind="error">{error}</Notice>
      <button disabled={busy || !runtime}>{busy ? 'Signing in…' : 'Open administration →'}</button>
    </form>
  );
}
function Home() {
  const { data: runtime } = useResource('/api/runtime');
  const { data, error } = useResource('/api/examples');
  return (
    <main className="home">
      <section className="hero court">
        <div className="eyebrow">A stronger season starts here</div>
        <h1>
          One team.
          <br />
          <em>A whole community.</em>
        </h1>
        <p className="hero-copy">
          Help volleyball athletes get more time on the court. A simple fundraiser for families,
          teams, and the people cheering them on.
        </p>
        <div className="hero-note">
          <span className="number-mark">0%</span>
          <p>
            platform percentage.
            <br />
            <small>Processing, hosting, and email costs still apply.</small>
          </p>
        </div>
        <div className="hero-footer">
          {runtime?.mode !== 'pilot' && <span>Century High School</span>}
          <span>Tualatin Valley Volleyball Club</span>
        </div>
      </section>
      <section className="home-bottom">
        <div>
          <div className="eyebrow">
            {runtime?.mode === 'pilot' ? 'TVVC pilot preparation' : 'Explore the prototype'}
          </div>
          <h2>Find your rally.</h2>
          <p>
            {runtime?.mode === 'pilot'
              ? 'Public fundraising is not open. Payments and email are disabled while administrators prepare the platform. Use fictional campaign and athlete data for rehearsals.'
              : 'Sample campaigns start in preparation. Coaches launch them in the simulator. Use fictional contacts and athlete information only.'}
          </p>
          <Notice kind="error">{error}</Notice>
          {data?.campaigns.map((c) => (
            <Link className="campaign-link" href={`/c/${c.slug}`} key={c.slug}>
              <span>
                <small>{c.organizationName}</small>
                <strong>{c.name}</strong>
              </span>
              <span aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
        <Login
          onLogin={() => {
            history.pushState({}, '', '/admin');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
        />
      </section>
    </main>
  );
}
function Athlete({ token }) {
  const { data, setData, error } = useResource(`/api/athlete/${encodeURIComponent(token)}`);
  const [emails, setEmails] = useState(''),
    [profile, setProfile] = useState(null),
    [message, setMessage] = useState(''),
    [failure, setFailure] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data && !profile)
      setProfile({
        displayName: data.athlete.displayName,
        message: data.athlete.message || '',
        photo: data.athlete.photo || '',
        authorization: !!data.athlete.authorization,
      });
  }, [data]);
  async function save(done = false) {
    setBusy(true);
    setFailure('');
    try {
      const result = await api(`/api/athlete/${encodeURIComponent(token)}`, 'PATCH', {
        ...profile,
        emails,
        done,
      });
      setData(result);
      const resultInfo = result.contactResult;
      setMessage(
        `Progress saved.${resultInfo ? ` ${resultInfo.added.length} added; ${resultInfo.duplicates.length} duplicate(s).${resultInfo.invalid?.length ? ` Invalid: ${resultInfo.invalid.join(', ')}.` : ''}` : ''}${done ? ' Setup complete. Your coach reviews your public content before invitations can send.' : ''}`,
      );
      if (!resultInfo?.invalid?.length) setEmails('');
    } catch (e) {
      setFailure(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file) {
    if (!file) return;
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      setFailure('Choose a PNG, JPEG, or WebP photo smaller than 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setProfile((p) => ({ ...p, photo: reader.result }));
    reader.readAsDataURL(file);
  }
  if (error)
    return (
      <main className="narrow">
        <Notice kind="error">{error}</Notice>
        <Link href="/">Return home</Link>
      </main>
    );
  if (!data || !profile)
    return (
      <main className="narrow">
        <p>Loading your secure setup…</p>
      </main>
    );
  return (
    <main className="athlete-page narrow">
      <div className="eyebrow">{data.campaign.organizationName} · Athlete setup</div>
      <h1>
        Your rally
        <br />
        <em>starts with you.</em>
      </h1>
      <p className="lead">
        Hi {data.athlete.name}. A few minutes here can make a big difference for your team.
      </p>
      <div className="setup-status">
        <Status value={data.athlete.completed ? 'completed' : 'preparation'} />
        <Status value={data.athlete.approved ? 'approved' : 'approval_pending'} />
        <span>{data.contacts.length} contacts saved</span>
      </div>
      <Notice>
        Keep this private setup link to resume. Share only your public fundraising link. Preparation
        never sends donor emails.
      </Notice>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(true);
        }}
      >
        <section className="setup-step">
          <span className="step-number">01</span>
          <div>
            <h2>Bring your supporters.</h2>
            <p>Twenty addresses is a helpful recommendation. Any number is welcome.</p>
            <Field
              label="Paste donor email addresses"
              hint="Separate with spaces, commas, semicolons, or new lines. Duplicates are safely combined."
            >
              <textarea
                rows="5"
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                placeholder="supporter@example.test, family@example.test"
              />
            </Field>
            {data.contacts.length > 0 && (
              <details>
                <summary>Your saved contacts ({data.contacts.length})</summary>
                <ul className="contact-list">
                  {data.contacts.map((email) => (
                    <li key={email}>{email}</li>
                  ))}
                </ul>
              </details>
            )}
            <button type="button" className="secondary" disabled={busy} onClick={() => save()}>
              Save progress
            </button>
          </div>
        </section>
        <section className="setup-step">
          <span className="step-number">02</span>
          <div>
            <h2>Put a face to the rally.</h2>
            <p>Optional. Use a photo you have permission to share publicly.</p>
            <div className="photo-editor">
              {profile.photo ? (
                <img
                  className="avatar large"
                  src={profile.photo}
                  alt="Your uploaded profile preview"
                />
              ) : (
                <div className="avatar large">{profile.displayName?.slice(0, 1) || 'Y'}</div>
              )}
              <Field label="Athlete photo" hint="PNG, JPEG or WebP · up to 2 MB">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => upload(e.target.files[0])}
                />
              </Field>
            </div>
            {profile.photo && (
              <button
                className="text-button"
                type="button"
                onClick={() => setProfile({ ...profile, photo: '' })}
              >
                Remove photo
              </button>
            )}
          </div>
        </section>
        <section className="setup-step">
          <span className="step-number">03</span>
          <div>
            <h2>Make it personal.</h2>
            <Field
              label="Public display name"
              hint="A first name and last initial keeps things simple."
              value={profile.displayName}
              maxLength="80"
              required
              onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
            />
            <Field label="Your message to supporters">
              <textarea
                rows="5"
                maxLength="2000"
                value={profile.message}
                onChange={(e) => setProfile({ ...profile, message: e.target.value })}
                placeholder="Tell your supporters what this season means to you…"
              />
            </Field>
            <label className="check-label">
              <input
                type="checkbox"
                checked={profile.authorization}
                onChange={(e) => setProfile({ ...profile, authorization: e.target.checked })}
              />
              <span>
                I have athlete/guardian authorization to submit this photo and message for public
                use. My coach will review it before publication.
              </span>
            </label>
          </div>
        </section>
        <Notice kind="error">{failure}</Notice>
        <Notice>{message}</Notice>
        <div className="button-row">
          <button type="button" className="secondary" disabled={busy} onClick={() => save()}>
            Save & return later
          </button>
          <button disabled={busy}>
            {busy ? 'Saving…' : data.athlete.completed ? 'Update setup →' : 'Done →'}
          </button>
        </div>
      </form>
      {data.athlete.completed && (
        <Share
          path={data.publicPath}
          title={`${profile.displayName}’s volleyball fundraiser`}
          organization={data.campaign.organizationName}
        />
      )}
    </main>
  );
}
function PublicPage({ slug, athleteId }) {
  const contact = new URLSearchParams(location.search).get('contact');
  const query = new URLSearchParams();
  if (athleteId) query.set('athlete', athleteId);
  if (contact) query.set('contact', contact);
  const { data, error, refresh } = useResource(`/api/public/${encodeURIComponent(slug)}?${query}`);
  const [form, setForm] = useState({
      amount: '50',
      email: '',
      donorName: '',
      method: '',
      athleteId: athleteId || '',
      transaction: '',
    }),
    [receipt, setReceipt] = useState(null),
    [failure, setFailure] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data)
      setForm((f) => ({
        ...f,
        method:
          f.method ||
          Object.keys(methodNames).find((key) => data.campaign.paymentSettings[key]?.enabled) ||
          '',
      }));
  }, [data]);
  async function give(e) {
    e.preventDefault();
    setBusy(true);
    setFailure('');
    try {
      const result = await api(`/api/public/${encodeURIComponent(slug)}/donations`, 'POST', {
        ...form,
        intent: form.method !== 'stripe',
        requestId: crypto.randomUUID(),
      });
      setReceipt(result);
      try {
        sessionStorage.setItem(`rally-receipt:${slug}`, result.receiptToken);
      } catch {}
    } catch (e) {
      setFailure(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    let saved;
    try {
      saved = sessionStorage.getItem(`rally-receipt:${slug}`);
    } catch {}
    if (saved)
      api(`/api/receipt/${encodeURIComponent(saved)}`)
        .then((result) => {
          if (cancelled) return;
          setReceipt({ ...result, receiptToken: saved });
          setForm((current) => ({
            ...current,
            amount: String(result.donation.amountCents / 100),
            method: result.donation.method,
          }));
        })
        .catch(() => {
          try {
            sessionStorage.removeItem(`rally-receipt:${slug}`);
          } catch {}
        });
    return () => {
      cancelled = true;
    };
  }, [slug]);
  async function reportPayment(e) {
    e.preventDefault();
    setBusy(true);
    setFailure('');
    try {
      const result = await api(
        `/api/receipt/${encodeURIComponent(receipt.receiptToken)}/report`,
        'POST',
        { requestId: crypto.randomUUID(), amount: form.amount, transaction: form.transaction },
      );
      setReceipt((r) => ({ ...r, ...result }));
    } catch (e) {
      setFailure(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function simulate() {
    setBusy(true);
    try {
      const result = await api('/api/simulator/payments', 'POST', {
        receiptToken: receipt.receiptToken,
        eventId: crypto.randomUUID(),
      });
      const confirmed = await api(`/api/receipt/${encodeURIComponent(receipt.receiptToken)}`);
      setReceipt((r) => ({
        ...r,
        donation: result.donation,
        receiptWording: confirmed.receiptWording,
      }));
      await refresh();
    } catch (e) {
      setFailure(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (error)
    return (
      <main className="narrow">
        <Notice kind="error">{error}</Notice>
        <Link href="/">Return home</Link>
      </main>
    );
  if (!data) return <main className="narrow">Loading fundraiser…</main>;
  const c = data.campaign,
    a = data.athlete,
    p = c.paymentSettings,
    enabled = Object.keys(methodNames).filter((k) => p[k]?.enabled),
    active = c.status === 'active' || c.status === 'paused';
  return (
    <main className="public-page" style={{ '--org-accent': c.color || '#5ce1bc' }}>
      <section className="public-hero court">
        <div className="public-organization">
          {c.logo && (
            <img className="organization-logo" src={c.logo} alt={`${c.organizationName} logo`} />
          )}
          <div className="eyebrow">{c.organizationName}</div>
        </div>
        <Status value={c.status} />
        <div className="public-heading">
          {a && (
            <div className="avatar hero-avatar">
              {a.photo ? (
                <img src={a.photo} alt={`${a.displayName}’s approved athlete photo`} />
              ) : (
                a.displayName.slice(0, 1)
              )}
            </div>
          )}
          <h1>
            {a ? (
              <>
                Rally behind
                <br />
                <em>{a.displayName}.</em>
              </>
            ) : (
              <>
                A season worth
                <br />
                <em>rallying for.</em>
              </>
            )}
          </h1>
        </div>
        <p className="campaign-title">{c.name}</p>
        <p className="lead">{c.purpose}</p>
        {a?.message && (
          <blockquote>
            “{a.message}”<cite>— {a.displayName}</cite>
          </blockquote>
        )}
        <Progress total={data.totals.grossCents} goal={c.goalCents} />
        <div className="public-meta">
          <span>{data.totals.donationCount} confirmed donations</span>
          <span>
            Ends {c.endDate} · {c.timezone}
          </span>
          {a && (
            <span>
              {money(a.totalCents)} credited to {a.displayName}
            </span>
          )}
        </div>
      </section>
      <div className="public-body">
        <section className="donate-panel">
          <div className="eyebrow">Every contribution counts</div>
          <h2>Give the team a lift.</h2>
          <p>All funds go to {c.organizationName}. Athlete credit celebrates their fundraising.</p>
          {!active && (
            <Notice>
              {c.status === 'draft'
                ? 'Campaign preview. Contributions open after the coach launches.'
                : c.status === 'paused'
                  ? 'Fundraising is paused. Check back after the coach resumes.'
                  : 'This campaign is closed to new donations.'}
            </Notice>
          )}
          {receipt ? (
            <section className="receipt">
              <p className="receipt-wording">
                This payment reference is saved only in this browser tab. You can return here to
                report or review your simulated payment. Closing the tab removes the saved
                reference.
              </p>
              <Status value={receipt.donation.status} />
              <h3>
                {receipt.donation.status === 'confirmed'
                  ? 'Your demo contribution is confirmed.'
                  : receipt.donation.method === 'stripe'
                    ? 'Simulated checkout ready.'
                    : receipt.donation.reported
                      ? 'Payment report received.'
                      : 'Your payment reference is ready.'}
              </h3>
              <p>
                <strong>{money(receipt.donation.amountCents)}</strong> ·{' '}
                {methodNames[receipt.donation.method]}
              </p>
              <Field label="Unique donation reference">
                <input readOnly value={receipt.donation.reference} />
              </Field>
              {receipt.donation.method === 'stripe' ? (
                receipt.donation.status === 'pending' && (
                  <>
                    <Notice>
                      This button simulates a verified server-side payment event. No card is
                      charged. A browser success screen alone cannot confirm payment.
                    </Notice>
                    <button onClick={simulate} disabled={busy}>
                      Simulate verified payment
                    </button>
                  </>
                )
              ) : (
                <>
                  <PaymentInstructions
                    method={receipt.donation.method}
                    settings={p[receipt.donation.method]}
                    reference={receipt.donation.reference}
                  />
                  {receipt.donation.reported ? (
                    <Notice>
                      Pending verification. The coach confirms funds received; this report does not
                      increase fundraising totals. Campaign reminders remain paused until resolved.
                    </Notice>
                  ) : (
                    <>
                      <Notice>
                        Reference ready. No payment has been reported or confirmed, and reminders
                        continue. Use this reference with your external payment; return here to
                        report it.
                      </Notice>
                      <form onSubmit={reportPayment}>
                        <Field
                          label="Amount you sent ($)"
                          type="number"
                          min="0.01"
                          step="0.01"
                          required
                          value={form.amount}
                          onChange={(e) => setForm({ ...form, amount: e.target.value })}
                        />
                        <Field
                          label="Payment transaction/reference (if available)"
                          value={form.transaction}
                          onChange={(e) => setForm({ ...form, transaction: e.target.value })}
                        />
                        <button disabled={busy}>
                          {busy ? 'Reporting…' : 'Report payment sent →'}
                        </button>
                      </form>
                    </>
                  )}
                </>
              )}
              {receipt.receiptWording && (
                <p className="receipt-wording">{receipt.receiptWording}</p>
              )}
              <button
                className="secondary"
                onClick={() => {
                  try {
                    sessionStorage.removeItem(`rally-receipt:${slug}`);
                  } catch {}
                  setReceipt(null);
                }}
              >
                Return to donation form
              </button>
            </section>
          ) : (
            <form onSubmit={give}>
              <Field label="Contribution amount ($)">
                <div className="amount-options">
                  {[25, 50, 100].map((value) => (
                    <button
                      type="button"
                      className={String(value) === String(form.amount) ? 'selected' : 'secondary'}
                      key={value}
                      onClick={() => setForm({ ...form, amount: String(value) })}
                    >
                      ${value}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  required
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  aria-label="Custom contribution amount in dollars"
                />
              </Field>
              <div className="form-grid">
                <Field
                  label="Your name"
                  autoComplete="name"
                  value={form.donorName}
                  onChange={(e) => setForm({ ...form, donorName: e.target.value })}
                />
                <Field
                  label="Email"
                  type="email"
                  autoComplete="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <Field
                label="Fundraising credit"
                hint={
                  data.associations.length > 1
                    ? 'Several athletes invited you. Choose who receives credit; your contribution goes to the organization.'
                    : 'Optional — you can support the campaign as a whole.'
                }
              >
                <select
                  value={form.athleteId}
                  onChange={(e) => setForm({ ...form, athleteId: e.target.value })}
                >
                  <option value="">Overall campaign</option>
                  {data.athletes.map((athlete) => (
                    <option key={athlete.id} value={athlete.id}>
                      {athlete.displayName}
                      {data.associations.includes(athlete.id) ? ' · invited you' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <fieldset className="payment-options">
                <legend>Payment method</legend>
                {enabled.map((method) => (
                  <label key={method} className={form.method === method ? 'selected' : ''}>
                    <input
                      type="radio"
                      name="method"
                      checked={form.method === method}
                      onChange={() => setForm({ ...form, method })}
                    />
                    {methodNames[method]}
                  </label>
                ))}
              </fieldset>
              {form.method && form.method !== 'stripe' && (
                <>
                  <PaymentInstructions method={form.method} settings={p[form.method]} />
                  <p className="muted">
                    Get a unique reference first. Include it when paying externally, then report
                    that your payment was sent.
                  </p>
                </>
              )}
              <Notice kind="error">{failure}</Notice>
              <button disabled={busy || !active || !form.method}>
                {busy
                  ? 'Processing…'
                  : form.method === 'stripe'
                    ? 'Start simulated card contribution →'
                    : 'Get payment reference →'}
              </button>
              <small>
                No platform percentage. Payment processing fees may apply. All payments in this
                prototype are simulated.
              </small>
              <p className="receipt-wording">{c.receiptWording}</p>
            </form>
          )}
          <Notice kind="error">{receipt && failure}</Notice>
        </section>
        <aside className="supporters">
          <div className="eyebrow">Together on the court</div>
          <h2>Meet the team.</h2>
          {data.athletes.map((athlete) => (
            <Link
              href={`/c/${slug}/a/${athlete.id}`}
              className={`team-person ${athlete.id === a?.id ? 'current' : ''}`}
              key={athlete.id}
            >
              <div className="avatar">
                {athlete.photo ? (
                  <img src={athlete.photo} alt="" />
                ) : (
                  athlete.displayName.slice(0, 1)
                )}
              </div>
              <span>
                <strong>{athlete.displayName}</strong>
                <small>
                  {athlete.team} · {money(athlete.totalCents)}
                </small>
              </span>
              <span aria-hidden="true">↗</span>
            </Link>
          ))}
          <Share
            path={data.publicPath}
            title={a ? `${a.displayName}’s volleyball fundraiser` : c.name}
            organization={c.organizationName}
          />
          <p className="privacy-note">
            Donor contact lists stay private. Public pages display approved athlete content only.
          </p>
        </aside>
      </div>
    </main>
  );
}
function PaymentInstructions({ method, settings = {}, reference }) {
  const [portalPreview, setPortalPreview] = useState(false);
  return (
    <div className="payment-instructions">
      <strong>{methodNames[method]}</strong>
      {method === 'venmo' && (
        <p>Business profile: {settings.profile || 'Not configured · prototype placeholder'}</p>
      )}
      {method === 'school' &&
        (settings.url ? (
          <>
            <p>Configured destination: {settings.url}</p>
            <button
              type="button"
              className="secondary"
              onClick={() => setPortalPreview(!portalPreview)}
            >
              Preview school portal handoff
            </button>
            {portalPreview && (
              <Notice>
                Simulated redirect to {settings.url}. No external payment page opened.
                {reference
                  ? ` Donation reference: ${reference}.`
                  : ' Get your donation reference before paying.'}
              </Notice>
            )}
          </>
        ) : (
          <p>School payment URL not configured · prototype placeholder</p>
        ))}
      {method === 'check' && (
        <>
          <p>Payee: {settings.payee || 'Not configured · prototype placeholder'}</p>
          <p>Mailing address: {settings.address || 'Not configured · prototype placeholder'}</p>
        </>
      )}
      <p>{settings.instructions || 'Payment instructions await organization configuration.'}</p>
      {reference && (
        <p>
          Include reference <strong>{reference}</strong> with your payment.
        </p>
      )}
    </div>
  );
}
function Unsubscribe({ token }) {
  const [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <main className="narrow unsubscribe">
      <div className="eyebrow">Your inbox, your choice</div>
      <h1>
        Leave the
        <br />
        <em>email list.</em>
      </h1>
      <p>Stop fundraising emails from this organization. This also blocks queued messages.</p>
      {message ? (
        <Notice>{message}</Notice>
      ) : (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/api/unsubscribe/${encodeURIComponent(token)}`, 'POST', {});
              setMessage(
                'You are unsubscribed. No further fundraising emails will be sent by this organization.',
              );
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Updating…' : 'Unsubscribe'}
        </button>
      )}
      <Notice kind="error">{error}</Notice>
      <Link href="/">Return home</Link>
    </main>
  );
}

const adminTabs = ['Dashboard', 'Athletes', 'Donations', 'Campaign Settings'];
function AdminAccount({ administrator, onSignedOut }) {
  const { data, error, refresh } = useResource(
    administrator.role === 'owner' ? '/api/admin/accounts' : null,
  );
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [adminPassword, setAdminPassword] = useState(''),
    [currentPassword, setCurrentPassword] = useState(''),
    [role, setRole] = useState('admin'),
    [feedback, setFeedback] = useState(''),
    [failure, setFailure] = useState(''),
    [busy, setBusy] = useState(false);
  async function perform(fn) {
    setBusy(true);
    setFailure('');
    setFeedback('');
    try {
      await fn();
      setCurrentPassword('');
      setPassword('');
      setAdminPassword('');
    } catch (e) {
      setFailure(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel account-settings">
      <h2>Your account</h2>
      <p>
        Signed in as {administrator.email} · {administrator.role}
      </p>
      <Notice kind="error">{failure}</Notice>
      <Notice>{feedback}</Notice>
      <Field
        label="Your current password"
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          perform(async () => {
            await api('/api/admin/password', 'POST', { currentPassword, password });
            await onSignedOut();
          });
        }}
      >
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={16}
          maxLength={200}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p>
          Use a unique password of at least 16 characters. Changing it signs out all your sessions.
        </p>
        <button disabled={busy || !currentPassword}>Change password and sign out</button>
      </form>
      {administrator.role === 'owner' && (
        <>
          <h2>Administrator access</h2>
          <Notice kind="error">{error}</Notice>
          {!data && !error && <p>Loading administrators…</p>}
          <p>
            Each administrator has a separate account. Give new credentials directly to the intended
            person; no invitation email is sent.
          </p>
          <ul className="contact-list">
            {data?.accounts.map((account) => (
              <li key={account.id}>
                {account.email} · {account.role} · {account.active ? 'Active' : 'Disabled'}{' '}
                {account.id !== administrator.id && (
                  <button
                    className="secondary compact"
                    disabled={busy || !currentPassword}
                    onClick={() =>
                      perform(async () => {
                        await api(`/api/admin/accounts/${account.id}`, 'PATCH', {
                          active: !account.active,
                          currentPassword,
                        });
                        await refresh();
                        setFeedback('Account access updated. Disabled accounts are signed out.');
                      })
                    }
                  >
                    {account.active ? 'Disable access' : 'Enable access'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              perform(async () => {
                await api('/api/admin/accounts', 'POST', {
                  email,
                  password: adminPassword,
                  role,
                  currentPassword,
                });
                setEmail('');
                await refresh();
                setFeedback('Administrator created. No email was sent.');
              });
            }}
          >
            <Field
              label="New administrator email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              label="New administrator password"
              type="password"
              autoComplete="new-password"
              minLength={16}
              maxLength={200}
              required
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
            />
            <Field label="Access level">
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="admin">Administrator</option>
                <option value="owner">Organization owner</option>
              </select>
            </Field>
            <button disabled={busy || !currentPassword}>Create administrator</button>
          </form>
        </>
      )}
    </section>
  );
}
function Admin() {
  const { data, setData, error, refresh } = useResource('/api/admin');
  const [selected, setSelected] = useState(''),
    [tab, setTab] = useState('Dashboard'),
    [feedback, setFeedback] = useState(''),
    [failure, setFailure] = useState(''),
    [busy, setBusy] = useState(false),
    [create, setCreate] = useState(false),
    [duplicate, setDuplicate] = useState(false),
    [destination, setDestination] = useState({ filter: 'all', key: 0 });
  const selectedCampaign = data?.campaigns.find((c) => c.id === selected) || data?.campaigns[0];
  const campaign =
    data?.mode === 'pilot' && selectedCampaign
      ? { ...selectedCampaign, preparationOnly: true }
      : selectedCampaign;
  const sectionHeading = useRef(null);
  function navigate(section, filter = 'all') {
    setTab(section);
    setDestination((current) => ({ filter, key: current.key + 1 }));
    requestAnimationFrame(() => sectionHeading.current?.focus());
  }
  async function mutate(path, method, body, success = 'Saved.') {
    setBusy(true);
    setFailure('');
    setFeedback('');
    try {
      const result = await api(path, method, body);
      await refresh();
      setFeedback(success);
      return result;
    } catch (e) {
      setFailure(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const base = campaign ? `/api/admin/campaigns/${campaign.id}` : '';
  const action = (action) => mutate(`${base}/action`, 'POST', { action }, `${action} complete.`);
  if (!data)
    return (
      <main className="narrow">
        {error ? (
          <>
            <Notice>Administrator access requires a review login.</Notice>
            <Login onLogin={refresh} />
          </>
        ) : (
          <p>Loading administration…</p>
        )}
      </main>
    );
  return (
    <main className="admin-shell simplified-admin">
      <aside className="admin-sidebar">
        <div className="eyebrow">Coach’s workspace</div>
        <h2>{data.organization.name || data.organization.displayName || 'Organization'}</h2>
        <nav aria-label="Administrator sections">
          {(data.mode === 'pilot' ? ['Dashboard', 'Campaign Settings', 'Account'] : adminTabs).map(
            (item) => (
              <button
                key={item}
                className={tab === item ? 'active' : ''}
                aria-pressed={tab === item}
                onClick={() => navigate(item)}
              >
                {item}
                <span aria-hidden="true">{tab === item ? '→' : ''}</span>
              </button>
            ),
          )}
        </nav>
        <div className="sidebar-bottom">
          <small>
            {data.mode === 'pilot'
              ? 'TVVC pilot preparation · payments and email disabled'
              : 'Review simulation · real email and payments disabled'}
          </small>
          <button
            className="text-button"
            onClick={async () => {
              await api('/api/logout', 'POST', {});
              setData(null);
              refresh();
            }}
          >
            {data.mode === 'pilot' ? 'Sign out' : 'Switch organization / sign out'}
          </button>
        </div>
      </aside>
      <section className="admin-content">
        <div className="campaign-selector">
          <Field label="Campaign">
            <select
              value={campaign?.id || ''}
              onChange={(e) => {
                setSelected(e.target.value);
                setFeedback('');
                setFailure('');
                setCreate(false);
                setDuplicate(false);
                setDestination({ filter: 'all', key: destination.key + 1 });
              }}
            >
              {data.campaigns.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="campaign-tools">
            <button
              className="secondary compact"
              aria-expanded={create}
              onClick={() => {
                setCreate(!create);
                setDuplicate(false);
              }}
            >
              + New campaign
            </button>
            {campaign && (
              <button
                className="secondary compact"
                aria-expanded={duplicate}
                onClick={() => {
                  setDuplicate(!duplicate);
                  setCreate(false);
                }}
              >
                Duplicate
              </button>
            )}
            {campaign && !campaign.preparationOnly && (
              <Link
                className="button secondary compact"
                href={`/c/${campaign.slug}`}
                target="_blank"
              >
                Preview public page ↗
              </Link>
            )}
          </div>
        </div>
        <header className="admin-title">
          <h1 ref={sectionHeading} tabIndex="-1">
            {tab}
          </h1>
          {campaign && <Status value={campaign.status} />}
        </header>
        <Notice kind="error">{failure}</Notice>
        <Notice>{feedback}</Notice>
        {data.mode === 'pilot' && (
          <Notice>
            Preparation only. Campaign launch, public access, payments and email are disabled. Use
            fictional campaign and athlete data until the remaining launch requirements are
            complete.
          </Notice>
        )}
        {tab === 'Account' && (
          <AdminAccount
            administrator={data.administrator}
            onSignedOut={async () => {
              setData(null);
              await refresh();
            }}
          />
        )}
        {create && (
          <NewCampaign
            onCreate={async (form) => {
              const result = await mutate(
                '/api/admin/campaigns',
                'POST',
                form,
                'New campaign created in preparation.',
              );
              if (result) {
                setSelected(result.id);
                setCreate(false);
                navigate('Campaign Settings');
              }
            }}
            busy={busy}
          />
        )}
        {duplicate && campaign && (
          <DuplicateCampaign
            key={campaign.id}
            campaign={campaign}
            busy={busy}
            onDuplicate={async (name) => {
              const result = await mutate(
                `${base}/duplicate`,
                'POST',
                { name },
                'Campaign duplicated as a fresh draft; no contacts or donations copied.',
              );
              if (result) {
                setSelected(result.id);
                setDuplicate(false);
                navigate('Campaign Settings');
              }
            }}
          />
        )}
        {tab === 'Account' ? null : campaign ? (
          <>
            {tab === 'Dashboard' && (
              <Overview campaign={campaign} busy={busy} action={action} navigate={navigate} />
            )}
            {tab === 'Athletes' && (
              <Athletes
                key={campaign.id}
                campaign={campaign}
                mutate={mutate}
                base={base}
                busy={busy}
                destination={destination}
              />
            )}
            {tab === 'Donations' && (
              <Ledger
                key={campaign.id}
                campaign={campaign}
                mutate={mutate}
                base={base}
                busy={busy}
                error={failure}
                destination={destination}
              />
            )}
            <div hidden={tab !== 'Campaign Settings'}>
              <Settings
                key={campaign.id}
                campaign={campaign}
                mutate={mutate}
                base={base}
                busy={busy}
                action={action}
                destination={destination}
              />
            </div>
          </>
        ) : (
          <Empty>Create your first campaign to get started.</Empty>
        )}
      </section>
    </main>
  );
}
function DuplicateCampaign({ campaign, busy, onDuplicate }) {
  const [name, setName] = useState(`${campaign.name} · next season`);
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        onDuplicate(name);
      }}
    >
      <h2>Duplicate campaign</h2>
      <p>
        Copy settings into a fresh draft. Athletes, contacts, donations and messages stay with this
        campaign.
      </p>
      <Field
        label="New campaign name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button className="secondary" disabled={busy}>
        Create duplicate draft
      </button>
    </form>
  );
}
function NewCampaign({ onCreate, busy }) {
  const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
    end = new Date(Date.parse(today + 'T12:00:00Z') + 20 * 86400000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    name: '',
    purpose: '',
    goal: '10000',
    startDate: today,
    endDate: end,
    timezone: 'America/Los_Angeles',
  });
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate(form);
      }}
    >
      <h2>Start a new rally.</h2>
      <div className="form-grid">
        {[
          ['name', 'Campaign name', 'text'],
          ['goal', 'Goal ($)', 'number'],
          ['startDate', 'Start date', 'date'],
          ['endDate', 'End date', 'date'],
          ['timezone', 'Timezone', 'text'],
        ].map(([key, label, type]) => (
          <Field
            key={key}
            label={label}
            type={type}
            required
            value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          />
        ))}
      </div>
      <Field label="Purpose">
        <textarea
          required
          rows="3"
          value={form.purpose}
          onChange={(e) => setForm({ ...form, purpose: e.target.value })}
        />
      </Field>
      <button disabled={busy}>Create draft campaign</button>
    </form>
  );
}
function emailQueue(c) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: c.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(c.now));
  const counts = { ready: 0, scheduled: 0, held: 0, blocked: 0, overdue: 0, failed: 0, thanks: 0 };
  const eligible = [];
  for (const job of c.jobs) {
    if (job.type === 'thank-you') {
      if (job.status === 'queued') counts.thanks++;
      continue;
    }
    if (job.status === 'failed') {
      counts.failed++;
      continue;
    }
    if (job.status === 'blocked') {
      counts.blocked++;
      continue;
    }
    if (job.status !== 'queued') continue;
    const contact = c.contacts.find((contact) => contact.id === job.contactId);
    if (c.status === 'closed' || contact?.state === 'suppressed' || contact?.state === 'donated') {
      counts.blocked++;
      continue;
    }
    if (
      c.status !== 'active' ||
      today > c.endDate ||
      contact?.state === 'pending' ||
      !contact?.athleteIds.some((id) =>
        c.athletes.some((a) => a.id === id && a.completed && a.approved),
      )
    ) {
      counts.held++;
      continue;
    }
    if (job.dueDate < today) {
      counts.overdue++;
      continue;
    }
    if (job.dueDate === today) counts.ready++;
    else counts.scheduled++;
    eligible.push(job);
  }
  counts.next = eligible.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]?.dueDate;
  return counts;
}
function EmailSummary({ campaign: c, onDetails }) {
  const counts = emailQueue(c);
  return (
    <section className="panel email-summary">
      <div className="section-heading">
        <h2>Upcoming messages</h2>
        {onDetails && (
          <button className="text-button" onClick={onDetails}>
            View email activity →
          </button>
        )}
      </div>
      <div className="delivery-counts">
        <div>
          <strong>{counts.ready}</strong>
          <span>Ready today</span>
        </div>
        <div>
          <strong>{counts.scheduled}</strong>
          <span>Scheduled</span>
        </div>
        <div>
          <strong>{counts.held}</strong>
          <span>Held</span>
        </div>
        <div>
          <strong>{counts.blocked}</strong>
          <span>Blocked</span>
        </div>
      </div>
      <p>
        {c.status === 'draft'
          ? 'Preparation sends no donor messages. Launch queues approved athletes’ invitations.'
          : c.status === 'paused'
            ? 'Solicitations are paused. Resuming skips missed reminders.'
            : c.status === 'closed'
              ? 'Fundraising messages have stopped. Donation acknowledgments can still be simulated.'
              : counts.next
                ? `Next eligible fundraising date: ${counts.next} · ${c.timezone}.`
                : 'No eligible fundraising messages are scheduled.'}
      </p>
      <small>
        Held includes pending payments and profiles awaiting approval.{' '}
        {counts.overdue > 0 && `${counts.overdue} overdue message(s) will be skipped. `}
        {counts.failed > 0 && `${counts.failed} failed message(s) need review. `}
        {counts.thanks} queued thank-you acknowledgment(s), shown separately from fundraising. All
        delivery is simulated.
      </small>
    </section>
  );
}
function Overview({ campaign: c, busy, action, navigate }) {
  const approved = c.athletes.filter((a) => a.approved && a.completed).length;
  const stories = c.athletes.filter((a) => a.completed && !a.approved).length;
  const incomplete = c.athletes.filter((a) => !a.completed).length;
  const pending = c.ledger.filter(
    (d) => d.status === 'pending' && d.method !== 'stripe' && d.reported === true,
  ).length;
  const failed = c.jobs.filter((j) => j.status === 'failed').length;
  const attention = [
    [stories, 'Athlete stories need approval', 'Review athlete stories', 'Athletes', 'approval'],
    [
      pending,
      'Reported payments need verification',
      'Review reported payments',
      'Donations',
      'reported',
    ],
    [incomplete, 'Athletes have unfinished setup', 'Follow up on setup', 'Athletes', 'incomplete'],
    [failed, 'Messages failed delivery', 'Review failed emails', 'Campaign Settings', 'failed'],
  ].filter(([count]) => count > 0);
  return (
    <>
      <section className="dashboard-progress">
        <div className="dashboard-heading">
          <div>
            <h2>{c.name}</h2>
            <p>
              {c.status === 'draft'
                ? 'Prepare your team, then launch.'
                : c.status === 'closed'
                  ? 'Final confirmed totals. Reported payments can still be reconciled.'
                  : c.status === 'paused'
                    ? 'Fundraising emails are paused.'
                    : 'Track the rally and keep your team moving.'}
            </p>
          </div>
          <div className="dashboard-deadline">
            <span>
              {c.status === 'closed' ? 'Ended' : 'Ends'} {c.endDate}
            </span>
            <small>{c.timezone}</small>
          </div>
        </div>
        <Progress total={c.totals.grossCents} goal={c.goalCents} />
        <div className="campaign-actions">
          {c.status === 'draft' && (
            <button disabled={busy || c.preparationOnly} onClick={() => action('launch')}>
              {c.preparationOnly ? 'Launch disabled during preparation' : 'Launch campaign →'}
            </button>
          )}
          {c.status === 'active' && (
            <button className="secondary" disabled={busy} onClick={() => action('pause')}>
              Pause campaign
            </button>
          )}
          {c.status === 'paused' && (
            <button disabled={busy} onClick={() => action('resume')}>
              Resume campaign
            </button>
          )}
          {c.status === 'draft' && (
            <small>
              {c.preparationOnly
                ? 'Campaign drafts can be prepared. Public fundraising and invitations remain closed.'
                : 'Launch queues invitations for completed, approved athletes. No real email is sent.'}
            </small>
          )}
        </div>
      </section>
      <div className="kpi-row dashboard-metrics">
        <div>
          <span>Confirmed donations</span>
          <strong>{money(c.totals.grossCents)}</strong>
          <small>{c.totals.donationCount} confirmed donation(s)</small>
        </div>
        <div>
          <span>Athletes ready</span>
          <strong>
            {approved}
            <i> / {c.athletes.length}</i>
          </strong>
          <small>Setup complete and story approved</small>
        </div>
        <div>
          <span>Payments awaiting review</span>
          <strong>{pending}</strong>
          <small>Reported external payments · excluded from totals</small>
        </div>
      </div>
      <section className="panel attention-panel">
        <h2>Needs attention</h2>
        {attention.length ? (
          <div className="attention-list">
            {attention.map(([count, description, label, section, filter]) => (
              <div className="attention-row" key={label}>
                <span className="attention-count">{count}</span>
                <span>{description}</span>
                <button className="secondary compact" onClick={() => navigate(section, filter)}>
                  {label} →
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty>
            {c.status === 'closed'
              ? 'All reported payments are resolved. Your campaign is wrapped up.'
              : 'You’re caught up. No outstanding setup, payment or delivery tasks.'}
          </Empty>
        )}
      </section>
      {c.status === 'draft' && (
        <section className="panel preparation-checklist">
          <h2>Before you launch</h2>
          <ol>
            <li>
              <span>Add athletes and share private setup links</span>
              <strong>{c.athletes.length} added</strong>
            </li>
            <li>
              <span>Review completed stories and authorization</span>
              <strong>{approved} ready</strong>
            </li>
            <li>
              <span>Preview campaign settings and email timing</span>
              <button className="text-button" onClick={() => navigate('Campaign Settings')}>
                Review settings →
              </button>
            </li>
          </ol>
          <small>
            {c.contacts.length} unique donor contacts saved. Contacts stay private; no invitations
            are sent in preparation.
          </small>
        </section>
      )}
      <EmailSummary campaign={c} onDetails={() => navigate('Campaign Settings', 'email')} />
      <details className="panel compact-disclosure">
        <summary>
          <strong>Team totals</strong> <span>Confirmed only</span>
        </summary>
        {c.teamTotals.length ? (
          c.teamTotals.map((t) => (
            <div className="summary-row" key={t.team}>
              <span>{t.team || 'Unassigned team'}</span>
              <strong>{money(t.totalCents)}</strong>
            </div>
          ))
        ) : (
          <Empty>Team totals appear after athletes are added.</Empty>
        )}
      </details>
    </>
  );
}
function Athletes({ campaign: c, mutate, base, busy, destination }) {
  const [filter, setFilter] = useState(destination.filter);
  useEffect(() => setFilter(destination.filter), [destination.key]);
  const athletes = c.athletes.filter((a) =>
    filter === 'approval'
      ? a.completed && !a.approved
      : filter === 'incomplete'
        ? !a.completed
        : filter === 'ready'
          ? a.completed && a.approved
          : true,
  );
  const [form, setForm] = useState({ name: '', displayName: '', team: '' }),
    [csv, setCsv] = useState('name,displayName,team\n'),
    [result, setResult] = useState(null),
    [notes, setNotes] = useState({});
  return (
    <>
      <details className="panel add-athletes compact-disclosure">
        <summary>
          <strong>Add athletes</strong> <span>Single entry or CSV import</span>
        </summary>
        <div className="overview-columns">
          <form
            className="panel"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await mutate(
                `${base}/athletes`,
                'POST',
                form,
                'Athlete added. Save their private invitation link.',
              );
              if (r) {
                setResult(r);
                setForm({ name: '', displayName: '', team: '' });
              }
            }}
          >
            <h2>Add an athlete</h2>
            <Field
              label="Private full name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <div className="form-grid">
              <Field
                label="Public display name"
                required
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
              <Field
                label="Team"
                value={form.team}
                onChange={(e) => setForm({ ...form, team: e.target.value })}
              />
            </div>
            <button disabled={busy}>Add & create secure invitation</button>
            {result?.privatePath && (
              <div className="private-link">
                <strong>Private invitation · only share with this athlete</strong>
                <Link href={result.privatePath} target="_blank">
                  Open athlete setup ↗
                </Link>
                <input
                  aria-label="New private invitation URL"
                  readOnly
                  value={pathUrl(result.privatePath)}
                />
              </div>
            )}
          </form>
          <form
            className="panel"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await mutate(
                `${base}/import`,
                'POST',
                { csv },
                'CSV checked. Review import results.',
              );
              if (r) setResult(r);
            }}
          >
            <h2>Import your roster</h2>
            <Field
              label="CSV roster"
              hint="Required headers: name,displayName,team. The whole file is validated before anyone is added."
            >
              <textarea
                rows="6"
                spellCheck="false"
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
              />
            </Field>
            <input
              aria-label="Upload roster CSV"
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                if (e.target.files[0]) setCsv(await e.target.files[0].text());
              }}
            />
            <button disabled={busy}>Validate & import</button>
            {result?.errors?.map((item, i) => (
              <Notice key={i} kind="error">
                Row {item.row}: {item.error}
              </Notice>
            ))}
            {result?.imported && (
              <Notice>
                {result.imported.length} athlete(s) imported. Private links are listed with each
                athlete below.
              </Notice>
            )}
          </form>
        </div>
      </details>
      <section className="panel">
        <div className="section-heading">
          <h2>Athlete roster</h2>
          <span className="muted">{c.athletes.length} athletes</span>
        </div>
        <Field label="Athlete view">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All athletes</option>
            <option value="approval">Needs approval</option>
            <option value="incomplete">Setup incomplete</option>
            <option value="ready">Ready to fundraise</option>
          </select>
        </Field>
        {athletes.map((a) => (
          <details className="athlete-detail" key={a.id}>
            <summary>
              <div className="avatar">
                {a.photo ? <img src={a.photo} alt="" /> : a.displayName.slice(0, 1)}
              </div>
              <span>
                <strong>{a.name}</strong>
                <small>
                  {a.team || 'No team'} · Public: {a.displayName}
                </small>
              </span>
              <div className="roster-status">
                <span
                  className={`status status-${!a.completed ? 'incomplete' : a.approved ? 'approved' : 'approval_pending'}`}
                >
                  {!a.completed ? 'Setup incomplete' : a.approved ? 'Ready' : 'Needs approval'}
                </span>
                <strong>{money(a.totalCents)}</strong>
              </div>
              <span className="expand-cue" aria-hidden="true">
                ⌄
              </span>
            </summary>
            <div className="athlete-detail-body">
              <p>
                Invitation: <strong>{a.invitationStatus || 'ready'}</strong> · Authorization:{' '}
                <strong>{a.authorization ? 'Acknowledged by athlete' : 'Not acknowledged'}</strong>
              </p>
              {a.photo && (
                <img
                  className="approval-photo"
                  src={a.photo}
                  alt={`${a.displayName} submitted photo for review`}
                />
              )}
              <blockquote>{a.message || 'No personal message submitted.'}</blockquote>
              <Field
                label="Coach’s authorization record"
                hint="Record how athlete/guardian permission was obtained; acknowledgment alone does not replace your documented review."
                value={notes[a.id] || ''}
                onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
              />
              <div className="button-row">
                <button
                  disabled={busy || !a.completed || !notes[a.id]?.trim()}
                  onClick={() =>
                    mutate(
                      `${base}/athletes/${a.id}/approve`,
                      'POST',
                      { approved: true, authorizationNote: notes[a.id] },
                      'Public profile approved.',
                    )
                  }
                >
                  Approve public content
                </button>
                {a.approved && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      mutate(
                        `${base}/athletes/${a.id}/approve`,
                        'POST',
                        { approved: false },
                        'Public approval revoked.',
                      )
                    }
                  >
                    Revoke approval
                  </button>
                )}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    const r = await mutate(
                      `${base}/athletes/${a.id}/invite`,
                      'POST',
                      {},
                      'Invitation rotated. Previous link is revoked.',
                    );
                    if (r) setResult(r);
                  }}
                >
                  Rotate private link
                </button>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={() =>
                    mutate(
                      `${base}/athletes/${a.id}/invite`,
                      'POST',
                      { revoke: true },
                      'Private link revoked. Generate a new link when ready.',
                    )
                  }
                >
                  Revoke private link
                </button>
                <Link className="button secondary" href={`/c/${c.slug}/a/${a.id}`} target="_blank">
                  Public page ↗
                </Link>
              </div>
              <details className="athlete-contacts">
                <summary>
                  Donor contacts (
                  {c.contacts.filter((contact) => contact.athleteIds.includes(a.id)).length})
                </summary>
                <ul className="contact-list">
                  {c.contacts
                    .filter((contact) => contact.athleteIds.includes(a.id))
                    .map((contact) => (
                      <li key={contact.id}>
                        {contact.email} · {contact.state}
                      </li>
                    ))}
                </ul>
              </details>
              {a.privatePath && (
                <div className="private-link">
                  <strong>Private editing link — athlete only</strong>
                  <Link href={a.privatePath} target="_blank">
                    Open athlete setup ↗
                  </Link>
                  <input
                    aria-label={`Private setup URL for ${a.name}`}
                    value={pathUrl(a.privatePath)}
                    readOnly
                  />
                </div>
              )}
            </div>
          </details>
        ))}
        {!athletes.length && (
          <Empty>
            {c.athletes.length
              ? 'No athletes match this view.'
              : 'No athletes yet. Open Add athletes to enter one or import your roster.'}
          </Empty>
        )}
      </section>
    </>
  );
}
function AuditEntries({ entries }) {
  return entries.length ? (
    entries.map((entry, i) => (
      <details className="audit-item" key={i}>
        <summary>
          <strong>{entry.action}</strong>
          <span>
            {date(entry.at)} · {entry.actor}
          </span>
        </summary>
        <p>{entry.note}</p>
        <pre>{JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}</pre>
      </details>
    ))
  ) : (
    <Empty>Confirmations, corrections, refunds and credit changes appear here.</Empty>
  );
}
function Ledger({ campaign: c, mutate, base, busy, error, destination }) {
  const [editing, setEditing] = useState(null),
    [filter, setFilter] = useState(destination.filter);
  useEffect(() => setFilter(destination.filter), [destination.key]);
  const isReported = (d) => d.status === 'pending' && d.method !== 'stripe' && d.reported === true;
  const pending = c.ledger.filter(isReported);
  const rows = c.ledger.filter(
    (d) =>
      !isReported(d) &&
      (filter === 'all' ||
        d.status === filter ||
        (filter === 'reserved' && d.status === 'pending' && d.reported === false)),
  );
  function donationTable(donations) {
    return (
      <div className="table-scroll donation-table">
        <table>
          <thead>
            <tr>
              <th>Donation / donor</th>
              <th>Amount / fees</th>
              <th>Method</th>
              <th>Status</th>
              <th>Credit</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {donations.map((d) => (
              <tr key={d.id}>
                <td data-label="Donation">
                  <strong>{d.reference}</strong>
                  <small>
                    {d.donorName || 'Supporter'} · {d.email}
                  </small>
                </td>
                <td data-label="Amount">
                  <strong>{money(d.amountCents)}</strong>
                  <small>Fee: {d.feeCents === null ? 'Unknown' : money(d.feeCents)}</small>
                </td>
                <td data-label="Method">{methodNames[d.method]}</td>
                <td data-label="Status">
                  <Status value={d.status} />
                  {d.status === 'pending' && d.reported === false && (
                    <small>
                      {d.method === 'stripe'
                        ? 'Checkout awaiting verified event'
                        : 'Reference only · no payment reported'}
                    </small>
                  )}
                </td>
                <td data-label="Credit">
                  {c.athletes.find((a) => a.id === d.athleteId)?.displayName || 'Campaign'}
                </td>
                <td data-label="Review">
                  <button className="secondary compact" onClick={() => setEditing(d)}>
                    Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <>
      <div className="kpi-row finance-metrics">
        <div>
          <span>Confirmed gross</span>
          <strong>{money(c.totals.grossCents)}</strong>
          <small>{c.totals.donationCount} donations</small>
        </div>
        <div>
          <span>Known fees</span>
          <strong>{money(c.totals.knownFeeCents)}</strong>
          <small>{c.totals.unknownFeeCount} donation(s) with unknown fees</small>
        </div>
        <div>
          <span>{c.totals.unknownFeeCount ? 'Known net subtotal' : 'Net proceeds'}</span>
          <strong>{money(c.totals.knownNetCents)}</strong>
          <small>
            {c.totals.unknownFeeCount
              ? 'Excludes donations with unknown fees'
              : 'All recorded fees accounted for'}
          </small>
        </div>
      </div>
      <div className="donation-toolbar">
        <Field label="Donation view">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All donations</option>
            <option value="reported">Reported payments</option>
            <option value="pending">All pending</option>
            <option value="reserved">Unreported references</option>
            <option value="confirmed">Confirmed</option>
            <option value="rejected">Rejected</option>
            <option value="refunded">Refunded</option>
          </select>
        </Field>
        <a className="button secondary" href={`${base}/export`}>
          Export CSV ↓
        </a>
      </div>
      {['all', 'pending', 'reported'].includes(filter) && (
        <section className="panel reported-payments">
          <div className="section-heading">
            <div>
              <h2>Reported payments awaiting review</h2>
              <p>
                Verify funds received before these amounts count. Fundraising reminders stay paused
                until resolved.
              </p>
            </div>
            <span className="attention-count">{pending.length}</span>
          </div>
          {pending.length ? (
            donationTable(pending)
          ) : (
            <Empty>No reported external payments need review.</Empty>
          )}
        </section>
      )}
      {filter !== 'reported' && (
        <section className="panel">
          <h2>Donation history</h2>
          <p>
            Only confirmed, non-refunded contributions count. Unreported references are separate
            from payment reports.
          </p>
          {rows.length ? donationTable(rows) : <Empty>No donations match this view.</Empty>}
        </section>
      )}
      {editing && (
        <LedgerEditor
          key={editing.id}
          donation={editing}
          campaign={c}
          athletes={c.athletes}
          busy={busy}
          error={error}
          close={() => setEditing(null)}
          save={async (form) => {
            const result = await mutate(
              `${base}/ledger/${editing.id}`,
              'POST',
              { ...form, requestId: crypto.randomUUID() },
              'Ledger updated and audit record saved.',
            );
            if (result) setEditing(null);
          }}
        />
      )}
      <details className="panel compact-disclosure">
        <summary>
          <strong>Campaign audit trail</strong> <span>{c.audit.length} entries</span>
        </summary>
        <AuditEntries entries={c.audit} />
      </details>
    </>
  );
}
function LedgerEditor({ donation: d, campaign, athletes, busy, close, save, error }) {
  const [form, setForm] = useState({
    action:
      d.status === 'pending'
        ? d.method === 'stripe'
          ? 'reject'
          : 'confirm'
        : d.status === 'confirmed'
          ? 'correct'
          : 'attribute',
    amount: String(d.amountCents / 100),
    fee: d.feeCents === null ? '' : String(d.feeCents / 100),
    method: d.method,
    receivedDate:
      d.receivedDate?.slice(0, 10) ||
      new Intl.DateTimeFormat('en-CA', {
        timeZone: campaign.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(campaign.now)),
    transaction: d.transaction || '',
    athleteId: d.athleteId || '',
    note: '',
  });
  const modalRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = modalRef.current;
    const selectable = () => [
      ...dialog.querySelectorAll(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]',
      ),
    ];
    selectable()[0]?.focus();
    const keydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key === 'Tab') {
        const items = selectable(),
          first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    dialog.addEventListener('keydown', keydown);
    return () => {
      dialog.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, []);
  const financial = ['confirm', 'correct'].includes(form.action);
  return (
    <div className="modal-backdrop">
      <section
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ledger-dialog-title"
      >
        <div className="section-heading">
          <h2 id="ledger-dialog-title">Review {d.reference}</h2>
          <button className="secondary compact" onClick={close} aria-label="Close donation review">
            ×
          </button>
        </div>
        <Status value={d.status} />
        {d.method === 'stripe' && d.status === 'pending' && (
          <Notice>
            Card confirmation uses the verified simulator event on the donor checkout page. A coach
            cannot manually confirm a pending card payment.
          </Notice>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(form);
          }}
        >
          <Field label="Ledger action">
            <select
              value={form.action}
              onChange={(e) => setForm({ ...form, action: e.target.value })}
            >
              {d.status === 'pending' && (
                <>
                  {d.method !== 'stripe' && <option value="confirm">Confirm funds received</option>}
                  <option value="reject">Reject report</option>
                </>
              )}
              {d.status === 'confirmed' && (
                <>
                  <option value="correct">Correct contribution</option>
                  <option value="refund">Record refund</option>
                </>
              )}
              <option value="attribute">Change fundraising credit</option>
            </select>
          </Field>
          {financial && (
            <>
              <div className="form-grid">
                <Field
                  label="Received amount ($)"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
                <Field
                  label="Known fee ($)"
                  hint="Blank means unknown, never zero."
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.fee}
                  onChange={(e) => setForm({ ...form, fee: e.target.value })}
                />
                <Field
                  label="Received date"
                  type="date"
                  required
                  value={form.receivedDate}
                  onChange={(e) => setForm({ ...form, receivedDate: e.target.value })}
                />
                <Field label="Received method">
                  <select
                    value={form.method}
                    onChange={(e) => setForm({ ...form, method: e.target.value })}
                  >
                    {Object.entries(methodNames).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field
                label="Transaction/reference when available"
                value={form.transaction}
                onChange={(e) => setForm({ ...form, transaction: e.target.value })}
              />
            </>
          )}
          <Field label="Fundraising credit">
            <select
              value={form.athleteId}
              onChange={(e) => setForm({ ...form, athleteId: e.target.value })}
            >
              <option value="">Overall campaign</option>
              {athletes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason / audit note">
            <textarea
              required
              rows="3"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>
          <Notice kind="error">{error}</Notice>
          <button disabled={busy}>Save ledger action</button>
        </form>
        <details className="donation-audit">
          <summary>Donation audit history</summary>
          <AuditEntries
            entries={campaign.audit.filter(
              (entry) =>
                entry.before?.id === d.id || entry.after?.id === d.id || entry.donationId === d.id,
            )}
          />
        </details>
      </section>
    </div>
  );
}
function EmailActivity({ campaign: c, mutate, base, busy, destination }) {
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    if (destination.filter === 'failed') setFilter('failed');
    else if (destination.filter === 'email') setFilter('all');
  }, [destination.key]);
  const jobs = c.jobs.filter(
    (job) =>
      filter === 'all' ||
      job.status === filter ||
      (filter === 'solicitation' && job.type === 'solicitation') ||
      (filter === 'thank-you' && job.type === 'thank-you'),
  );
  const [days, setDays] = useState('1'),
    [email, setEmail] = useState(''),
    [reason, setReason] = useState('unsubscribe');
  return (
    <>
      <details className="prototype-testing compact-disclosure" hidden={c.preparationOnly}>
        <summary>
          <strong>Prototype testing</strong> <span>Simulated sends and campaign clock</span>
        </summary>
        <section className="simulator-panel">
          <div>
            <div className="eyebrow">Local test controls</div>
            <h2>Simulate email delivery</h2>
            <p>
              Campaign clock: <strong>{date(c.now)}</strong>
            </p>
            <small>
              Simulated sends only. Paused and closed campaigns do not send solicitations. Resume
              skips overdue messages.
            </small>
          </div>
          <div className="simulator-actions">
            <button
              disabled={busy}
              onClick={() =>
                mutate(
                  `${base}/action`,
                  'POST',
                  { action: 'run' },
                  'Worker ran. Review the simulated delivery log.',
                )
              }
            >
              Run email worker
            </button>
            <Field
              label="Advance clock (days)"
              type="number"
              min="1"
              max="365"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                mutate(
                  `${base}/action`,
                  'POST',
                  { action: 'advance', days: Number(days) },
                  'Clock advanced and worker ran.',
                )
              }
            >
              Advance & run →
            </button>
          </div>
        </section>
      </details>
      <section className="panel">
        <div className="section-heading">
          <h2>Messages & delivery</h2>
          <Status value="simulation" />
        </div>
        <Field label="Message view">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All messages</option>
            <option value="failed">Failed</option>
            <option value="queued">Queued</option>
            <option value="sent">Sent</option>
            <option value="blocked">Blocked</option>
            <option value="skipped">Skipped</option>
            <option value="solicitation">Fundraising messages</option>
            <option value="thank-you">Thank-you acknowledgments</option>
          </select>
        </Field>
        {jobs.length ? (
          jobs.map((job) => (
            <details className="job-item" key={job.id}>
              <summary>
                <span>
                  <strong>{job.subject}</strong>
                  <small>
                    {job.recipient} · {job.type === 'thank-you' ? 'Thank-you' : `Day ${job.day}`} ·{' '}
                    {date(job.dueDate)}
                  </small>
                </span>
                <Status value={job.status} />
              </summary>
              <div className="job-body">
                <p>{job.reason}</p>
                <pre>{job.body}</pre>
                {job.status === 'failed' && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      mutate(
                        `${base}/jobs/${job.id}/retry`,
                        'POST',
                        {},
                        'Failed job safely retried.',
                      )
                    }
                  >
                    Retry simulated failure
                  </button>
                )}
                {job.status === 'queued' && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      mutate(
                        `${base}/jobs/${job.id}/fail`,
                        'POST',
                        {},
                        'Simulated failure recorded.',
                      )
                    }
                  >
                    Simulate delivery failure
                  </button>
                )}
                {String(job.body).match(/\/unsubscribe\/[^\s<>]+/) && (
                  <Link
                    href={String(job.body).match(/\/unsubscribe\/[^\s<>]+/)[0]}
                    target="_blank"
                    className="button secondary"
                  >
                    Review unsubscribe flow ↗
                  </Link>
                )}
              </div>
            </details>
          ))
        ) : (
          <Empty>
            {c.jobs.length
              ? 'No messages match this view.'
              : 'No messages queued during preparation. Launch after athlete content approval.'}
          </Empty>
        )}
      </section>
      <div className="overview-columns">
        <form
          className="panel"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await mutate(
              `${base}/suppress`,
              'POST',
              { email, reason },
              'Recipient suppressed. Queued and future fundraising messages blocked.',
            );
            if (r) setEmail('');
          }}
        >
          <h2>Suppress a recipient</h2>
          <Field
            label="Email address"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Field label="Reason">
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="unsubscribe">Unsubscribe</option>
              <option value="complaint">Complaint</option>
              <option value="hard_bounce">Hard bounce</option>
            </select>
          </Field>
          <button disabled={busy}>Suppress organization-wide</button>
        </form>
        <section className="panel">
          <h2>Campaign contact states</h2>
          {c.contacts.map((contact) => (
            <div className="summary-row" key={contact.id}>
              <span>
                {contact.email}
                <small>{contact.athleteIds.length} athlete association(s)</small>
              </span>
              <Status value={contact.state} />
            </div>
          ))}
          {!c.contacts.length && <Empty>No donor contacts added yet.</Empty>}
        </section>
      </div>
      <section className="panel">
        <h2>Activity log</h2>
        {c.activity.length ? (
          c.activity.map((entry) => (
            <div className="activity-item" key={entry.id}>
              <span className="activity-dot" />
              <div>
                <strong>{entry.type.replaceAll('_', ' ')}</strong>
                <p>
                  {typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail)}
                </p>
                <small>{date(entry.at)}</small>
              </div>
            </div>
          ))
        ) : (
          <Empty>Campaign actions and simulated delivery events appear here.</Empty>
        )}
      </section>
    </>
  );
}
function Settings({ campaign: c, mutate, base, busy, action, destination }) {
  const activityPanel = useRef(null);
  useEffect(() => {
    if (['email', 'failed'].includes(destination.filter) && activityPanel.current) {
      activityPanel.current.open = true;
      requestAnimationFrame(() => activityPanel.current.querySelector('summary')?.focus());
    }
  }, [destination.key]);
  const [form, setForm] = useState({
    name: c.name,
    purpose: c.purpose,
    goal: String(c.goalCents / 100),
    startDate: c.startDate,
    endDate: c.endDate,
    timezone: c.timezone,
    color: c.color || '#5ce1bc',
    logo: c.logo || '',
    organizationName: c.organizationName,
    paymentSettings: structuredClone(c.paymentSettings),
    schedule: structuredClone(c.schedule),
  });
  const [logoError, setLogoError] = useState(''),
    [validationError, setValidationError] = useState('');
  function uploadLogo(file) {
    if (!file) return;
    setLogoError('');
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      setLogoError('Choose a PNG, JPEG, or WebP logo smaller than 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, logo: reader.result }));
    reader.readAsDataURL(file);
  }
  const changePayment = (method, key, value) =>
    setForm({
      ...form,
      paymentSettings: {
        ...form.paymentSettings,
        [method]: { ...form.paymentSettings[method], [key]: value },
      },
    });
  return (
    <>
      <form
        onInvalidCapture={(e) => {
          // Native validation visits every invalid field. Reveal and focus only
          // the first, while cancelling hidden-control browser focus attempts.
          e.preventDefault();
          const formElement = e.currentTarget;
          const first = formElement.querySelector(
            'input:invalid, select:invalid, textarea:invalid',
          );
          if (e.target !== first) return;
          for (
            let ancestor = first.parentElement;
            ancestor && ancestor !== formElement;
            ancestor = ancestor.parentElement
          ) {
            if (ancestor.tagName === 'DETAILS') ancestor.open = true;
          }
          const label =
            first.closest('label')?.querySelector('span')?.textContent || 'the highlighted setting';
          setValidationError(`Please check ${label}. ${first.validationMessage}`);
          requestAnimationFrame(() => {
            if (first.isConnected) {
              first.focus();
              first.scrollIntoView({ block: 'center', behavior: 'instant' });
            }
          });
        }}
        onChange={() => setValidationError('')}
        onSubmit={(e) => {
          e.preventDefault();
          setValidationError('');
          mutate(
            base,
            'PATCH',
            c.status === 'draft'
              ? form
              : Object.fromEntries(
                  Object.entries(form).filter(
                    ([key]) => !['startDate', 'endDate', 'timezone'].includes(key),
                  ),
                ),
            'Campaign settings saved.',
          );
        }}
      >
        <details className="panel settings-group compact-disclosure" open>
          <summary>
            <strong>Basics & branding</strong> <span>Purpose, goal, dates and organization</span>
          </summary>
          <div className="form-grid">
            {[
              ['name', 'Campaign name', 'text'],
              ['organizationName', 'Organization display name', 'text'],
              ['goal', 'Fundraising goal ($)', 'number'],
              ['startDate', 'Start date', 'date'],
              ['endDate', 'End date', 'date'],
              ['timezone', 'IANA timezone', 'text'],
            ].map(([key, label, type]) => (
              <Field
                key={key}
                label={label}
                type={type}
                disabled={
                  c.status !== 'draft' && ['startDate', 'endDate', 'timezone'].includes(key)
                }
                required
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            ))}
            <Field
              label="Organization accent color"
              type="color"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
            />
          </div>
          <div className="logo-editor">
            <h3>Organization logo</h3>
            {form.logo ? (
              <img src={form.logo} alt="Configured organization logo preview" />
            ) : (
              <p className="logo-placeholder">No logo configured · prototype placeholder</p>
            )}
            <Field
              label="Upload organization logo"
              hint="Use an authorized PNG, JPEG, or WebP image, up to 2 MB."
            >
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={c.preparationOnly}
                onChange={(e) => uploadLogo(e.target.files[0])}
              />
            </Field>
            {form.logo && (
              <button
                type="button"
                className="text-button"
                onClick={() => setForm({ ...form, logo: '' })}
              >
                Remove logo
              </button>
            )}
            <Notice kind="error">{logoError}</Notice>
          </div>
          <Field label="Campaign purpose">
            <textarea
              rows="4"
              required
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            />
          </Field>
        </details>
        <details className="panel settings-group compact-disclosure">
          <summary>
            <strong>Payment methods</strong> <span>Enabled methods and instructions</span>
          </summary>
          <p>
            Details below are organization configuration. No live checkout or payments are
            connected.
          </p>
          {Object.entries(methodNames).map(([method, label]) => (
            <details
              key={method}
              className="settings-method"
              open={form.paymentSettings[method].enabled}
            >
              <summary>
                {label}
                <Status value={form.paymentSettings[method].enabled ? 'enabled' : 'disabled'} />
              </summary>
              <label className="check-label">
                <input
                  type="checkbox"
                  disabled={c.preparationOnly}
                  checked={form.paymentSettings[method].enabled}
                  onChange={(e) => changePayment(method, 'enabled', e.target.checked)}
                />
                Enable this method
              </label>
              {method === 'stripe' ? (
                <Notice>
                  Simulated verified payment events only. Configure a live Stripe account, secrets,
                  and verified webhook before a future launch.
                </Notice>
              ) : (
                <>
                  {(method === 'venmo'
                    ? [['profile', 'Venmo Business Profile']]
                    : method === 'school'
                      ? [['url', 'School payment portal URL']]
                      : [
                          ['payee', 'Check payee'],
                          ['address', 'Mailing address'],
                        ]
                  ).map(([key, label]) => (
                    <Field
                      key={key}
                      label={label}
                      type={key === 'url' ? 'url' : 'text'}
                      placeholder="Not configured · prototype placeholder"
                      value={form.paymentSettings[method][key] || ''}
                      onChange={(e) => changePayment(method, key, e.target.value)}
                    />
                  ))}
                  <Field label="Payment / reference instructions">
                    <textarea
                      rows="3"
                      placeholder="Organization-approved instructions required for live use"
                      value={form.paymentSettings[method].instructions || ''}
                      onChange={(e) => changePayment(method, 'instructions', e.target.value)}
                    />
                  </Field>
                </>
              )}
            </details>
          ))}
        </details>
        <details className="panel settings-group compact-disclosure">
          <summary>
            <strong>Email schedule & templates</strong>{' '}
            <span>Timing and organization-sent messages</span>
          </summary>
          {c.status !== 'draft' && (
            <Notice>
              Campaign dates and timezone are locked after launch. You can still edit email timing,
              templates, and optional messages; missed reminders are skipped and sent messages do
              not repeat.
            </Notice>
          )}
          <fieldset className="schedule-fieldset">
            <p>
              Organization-sent invitations and reminders. Supported tokens:{' '}
              <code>{'{{organization}} {{campaign}} {{athlete}} {{message}} {{link}}'}</code>
            </p>
            <Notice>
              Templates preview and simulate locally. Recipient permission and provider approval are
              required before live delivery.
            </Notice>
            {form.schedule.map((item, index) => (
              <details className="template-item" key={item.id}>
                <summary>
                  <span>
                    Day {item.day} · {item.subject}
                  </span>
                  <Status value={item.enabled ? 'enabled' : 'disabled'} />
                </summary>
                <div className="template-fields">
                  <div className="form-grid">
                    <Field
                      label="Campaign day"
                      type="number"
                      min="1"
                      max="365"
                      disabled={item.id === 'invitation'}
                      required
                      value={item.day}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          schedule: form.schedule.map((s, i) =>
                            i === index ? { ...s, day: Number(e.target.value) } : s,
                          ),
                        })
                      }
                    />
                    <label className="check-label">
                      <input
                        type="checkbox"
                        disabled={item.day === 1}
                        checked={item.enabled}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            schedule: form.schedule.map((s, i) =>
                              i === index ? { ...s, enabled: e.target.checked } : s,
                            ),
                          })
                        }
                      />
                      Enabled
                    </label>
                  </div>
                  <Field
                    label="Subject"
                    required
                    value={item.subject}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        schedule: form.schedule.map((s, i) =>
                          i === index ? { ...s, subject: e.target.value } : s,
                        ),
                      })
                    }
                  />
                  <Field label="Organization-sent message">
                    <textarea
                      required
                      rows="6"
                      value={item.body}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          schedule: form.schedule.map((s, i) =>
                            i === index ? { ...s, body: e.target.value } : s,
                          ),
                        })
                      }
                    />
                  </Field>
                  {item.day !== 1 && (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        setForm({ ...form, schedule: form.schedule.filter((_, i) => i !== index) })
                      }
                    >
                      Remove optional message
                    </button>
                  )}
                </div>
              </details>
            ))}
            <button
              className="secondary"
              type="button"
              onClick={() =>
                setForm({
                  ...form,
                  schedule: [
                    ...form.schedule,
                    {
                      id: crypto.randomUUID(),
                      day: 15,
                      enabled: false,
                      subject: 'An update from {{organization}}',
                      body: '{{organization}} campaign update: {{campaign}}.\n{{message}}\nSupport our team: {{link}}',
                    },
                  ],
                })
              }
            >
              + Add optional message
            </button>
          </fieldset>
        </details>
        <Notice kind="error">{validationError}</Notice>
        <div className="settings-save">
          <button disabled={busy}>Save campaign settings</button>
          <small>Save changes to basics, payment methods and email templates together.</small>
        </div>
      </form>
      <details className="panel compact-disclosure email-activity-group" ref={activityPanel}>
        <summary>
          <strong>Email & activity</strong>{' '}
          <span>Delivery previews, recipient controls and logs</span>
        </summary>
        <EmailSummary campaign={c} />
        <EmailActivity
          campaign={c}
          mutate={mutate}
          base={base}
          busy={busy}
          destination={destination}
        />
      </details>
      <details className="panel compact-disclosure campaign-management">
        <summary>
          <strong>Campaign management</strong> <span>Status and closing</span>
        </summary>
        <p>
          Current status: <Status value={c.status} />
        </p>
        {c.status === 'closed' ? (
          <Empty>This campaign is closed. Pending contributions can still be reconciled.</Empty>
        ) : (
          <>
            <p>
              Closing permanently stops fundraising messages. Pending contributions can still be
              reconciled.
            </p>
            <button
              className="danger-button"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    'Close this campaign permanently? Pending contributions can still be reconciled.',
                  )
                )
                  action('close');
              }}
            >
              Close campaign
            </button>
          </>
        )}
      </details>
    </>
  );
}
export default function App() {
  const { data: runtime } = useResource('/api/runtime');
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const changed = () => setPath(location.pathname);
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  let content;
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'admin') content = <Admin />;
  else if (parts[0] === 'join' && parts[1]) content = <Athlete key={parts[1]} token={parts[1]} />;
  else if (parts[0] === 'c' && parts[1])
    content = (
      <PublicPage key={path} slug={parts[1]} athleteId={parts[2] === 'a' ? parts[3] : null} />
    );
  else if (parts[0] === 'unsubscribe' && parts[1]) content = <Unsubscribe token={parts[1]} />;
  else content = <Home />;
  return (
    <>
      <div className="prototype-banner">
        <span className="sim-dot" />
        <strong>{runtime?.mode === 'pilot' ? 'TVVC PILOT PREPARATION' : 'REVIEW PROTOTYPE'}</strong>
        <span>
          {runtime?.mode === 'pilot'
            ? 'Public fundraising, payments & email are disabled.'
            : 'Payments & email delivery are simulated. Use fictional data only.'}
        </span>
      </div>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Rally Fund home">
          <span className="brand-mark" aria-hidden="true">
            R<span>F</span>
          </span>
          RALLY<span>FUND</span>
        </Link>
        <nav aria-label="Primary">
          <Link href="/">Campaigns</Link>
          <Link className={path === '/admin' ? 'active' : ''} href="/admin">
            Coach login ↗
          </Link>
        </nav>
      </header>
      {content}
      <footer className="site-footer">
        <Link className="brand small-brand" href="/">
          RALLY<span>FUND</span>
        </Link>
        <p>Built for the team. Powered by the community.</p>
        <small>
          {runtime?.mode === 'pilot'
            ? 'TVVC pilot preparation · fundraising is not open'
            : 'First milestone · local simulator · 0% platform percentage'}
        </small>
      </footer>
    </>
  );
}
