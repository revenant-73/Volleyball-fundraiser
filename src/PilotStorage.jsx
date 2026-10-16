import React, { useEffect, useState } from 'react';

export function PilotMedia({ api, Field, Notice }) {
  const [images, setImages] = useState([]),
    [file, setFile] = useState(null),
    [purpose, setPurpose] = useState('organization-logo'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  async function load() {
    try {
      setImages((await api('/api/admin/media')).images);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function upload(event) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
        file.size > 2 * 1024 * 1024
      )
        throw new Error('Choose a PNG, JPEG or WebP image under 2 MB.');
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read this image.'));
        reader.readAsDataURL(file);
      });
      await api('/api/admin/media', 'POST', {
        purpose,
        base64,
        contentType: file.type,
        requestId: crypto.randomUUID(),
      });
      await load();
      setFile(null);
      event.target.reset();
      setMessage('Image saved privately. It has not been published.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel private-media">
      <h2>Private images</h2>
      <p>
        Only signed-in administrators for this organization can view these images. Uploading does
        not add an image to a public page or an athlete profile.
      </p>
      <Notice>
        Use fictional images for rehearsals. PNG, JPEG or WebP · up to 2 MB each. Uploaded metadata
        is removed; images are resized and stored encrypted.
      </Notice>
      <Notice kind="error">{error}</Notice>
      <Notice>{message}</Notice>
      <form onSubmit={upload}>
        <Field label="Image purpose">
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            <option value="organization-logo">Organization logo</option>
            <option value="athlete-photo">Athlete photo for later review</option>
          </select>
        </Field>
        <Field label="Private image file">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required
            onChange={(e) => setFile(e.target.files[0])}
          />
        </Field>
        <button disabled={busy || !file}>
          {busy ? 'Saving privately…' : 'Upload private image'}
        </button>
      </form>
      <p>
        Hiding an image revokes access to its preview. Stored copies remain in encrypted backups
        until a retention policy is approved. The preparation library supports 100 images and 4 MB
        total.
      </p>
      <div className="private-media-grid">
        {images.map((image) => (
          <article key={image.id}>
            {image.status === 'active' ? (
              <img src={image.url} alt="Private uploaded image" />
            ) : (
              <p>Image hidden</p>
            )}
            <p>
              {image.purpose === 'organization-logo' ? 'Organization logo' : 'Athlete photo'} ·{' '}
              {image.width} × {image.height}
            </p>
            {image.status === 'active' && (
              <button
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await api(`/api/admin/media/${image.id}`, 'PATCH', { action: 'hide' });
                    await load();
                    setMessage('Image hidden. Its preview is no longer accessible.');
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Hide image
              </button>
            )}
          </article>
        ))}
      </div>
      {!images.length && <p>No private images uploaded yet.</p>}
    </section>
  );
}

export function PilotOperations({ api, Field, Notice }) {
  const [data, setData] = useState(null),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function load() {
    try {
      setData(await api('/api/admin/backups'));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  const latest = data?.backups[0];
  return (
    <section className="panel pilot-operations">
      <h2>Backup health</h2>
      <Notice kind="error">{error}</Notice>
      <Notice>{message}</Notice>
      {data ? (
        <>
          <Notice kind={data.stale ? 'error' : 'info'}>
            {latest
              ? `Last verified backup: ${new Date(latest.createdAt).toLocaleString()}. Includes ${latest.mediaCount} private image(s).`
              : 'No verified cloud backup is available yet.'}
            {data.stale ? ' Backup is missing or older than 36 hours.' : ''}
          </Notice>
          <p>
            {data.schedule}. Database records and all stored images are encrypted together.{' '}
            {data.retention}.
          </p>
          {data.failureActive && (
            <Notice kind="error">
              A backup failure was recorded at {new Date(data.lastFailure).toLocaleString()}. Check
              function logs and confirm a newer backup has verified.
            </Notice>
          )}
        </>
      ) : (
        <p>Loading backup status…</p>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          setMessage('');
          try {
            await api('/api/admin/backups', 'POST', {
              currentPassword: password,
              requestId: crypto.randomUUID(),
            });
            setPassword('');
            await load();
            setMessage('Encrypted cloud backup created and verified.');
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field
          label="Your password for backup"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button disabled={busy}>{busy ? 'Backing up and verifying…' : 'Run backup now'}</button>
      </form>
      <h3>Verified recovery files</h3>
      <p>
        Downloads are encrypted. Keep the recovery key saved separately in a secure offline
        location; it cannot be downloaded from this page.
      </p>
      <ul className="contact-list">
        {data?.backups.map((backup) => (
          <li key={backup.id}>
            <a href={`/api/admin/backups/${backup.id}/download`} download>
              {new Date(backup.createdAt).toLocaleString()} · {backup.mediaCount} image(s) ·
              Download encrypted backup
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
