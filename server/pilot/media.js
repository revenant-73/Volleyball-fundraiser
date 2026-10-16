import { randomUUID, createHash } from 'node:crypto';
import { AppError, hash } from '../domain.js';

export const mediaKey = (asset) => `images/${asset.orgId}/${asset.id}`;
export const imageHash = (buffer) => createHash('sha256').update(buffer).digest('hex');
export const publicMedia = ({
  id,
  purpose,
  status,
  bytes,
  width,
  height,
  createdAt,
  campaignId,
  athleteId,
}) => ({
  id,
  purpose,
  status,
  bytes,
  width,
  height,
  createdAt,
  campaignId,
  athleteId,
  url: `/api/admin/media/${id}`,
});

export async function normalizeImage(input) {
  const formats = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };
  if (
    !formats[input.contentType] ||
    typeof input.base64 !== 'string' ||
    input.base64.length > 2800000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)
  )
    throw new AppError('Choose a PNG, JPEG or WebP image under 2 MB.');
  const source = Buffer.from(input.base64, 'base64');
  if (source.length > 2 * 1024 * 1024 || source.toString('base64') !== input.base64)
    throw new AppError('Choose an image under 2 MB.');
  // Load the native decoder only for authenticated pilot uploads. Review and
  // scheduled database backups do not need to initialize a native image runtime.
  const { default: sharp } = await import('sharp');
  try {
    const options = { limitInputPixels: 16_000_000, failOn: 'error' };
    const metadata = await sharp(source, options).metadata();
    if (
      metadata.format !== formats[input.contentType] ||
      (metadata.pages || 1) > 1 ||
      metadata.width > 8192 ||
      metadata.height > 8192
    )
      throw new Error('Unsupported image');
    // Re-encoding strips EXIF/GPS and other uploaded metadata. Never serve the
    // original bytes, filename, SVG, animation or a client-declared MIME type.
    const { data, info } = await sharp(source, options)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new AppError(
      'The image could not be decoded safely. Use a still PNG, JPEG or WebP under 16 megapixels.',
    );
  }
}

export function mediaService({ store, cipher }) {
  return {
    async upload(state, actor, input) {
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId || ''))
        throw new AppError('A unique upload request ID is required.');
      if (!['organization-logo', 'athlete-photo'].includes(input.purpose))
        throw new AppError('Choose an image purpose.');
      const campaignId = input.campaignId || null,
        athleteId = input.athleteId || null;
      if (
        campaignId &&
        !state.campaigns.some((c) => c.id === campaignId && c.orgId === actor.orgId)
      )
        throw new AppError('Campaign not found.', 404);
      if (
        athleteId &&
        !state.athletes.some(
          (a) => a.id === athleteId && a.campaignId === campaignId && a.orgId === actor.orgId,
        )
      )
        throw new AppError('Athlete not found.', 404);
      const fingerprint = hash(
        JSON.stringify([input.purpose, campaignId, athleteId, input.contentType, input.base64]),
      );
      const prior = state.mediaAssets.find(
        (a) => a.orgId === actor.orgId && a.requestId === input.requestId,
      );
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new AppError('Upload request ID already used with different content.', 409);
        return publicMedia(prior);
      }
      if (state.mediaAssets.filter((a) => a.orgId === actor.orgId).length >= 100)
        throw new AppError(
          'The preparation library supports 100 images. Contact the owner before adding more.',
          409,
        );
      const normalized = await normalizeImage(input);
      if (
        normalized.data.length > 2 * 1024 * 1024 ||
        state.mediaAssets
          .filter((a) => a.orgId === actor.orgId)
          .reduce((sum, a) => sum + a.bytes, 0) +
          normalized.data.length >
          4 * 1024 * 1024
      )
        throw new AppError(
          'The preparation library has a 4 MB total image limit. Contact the owner before adding more.',
          409,
        );
      const asset = {
        id: randomUUID(),
        orgId: actor.orgId,
        campaignId,
        athleteId,
        createdBy: actor.userId,
        status: 'active',
        requestId: input.requestId,
        fingerprint,
        purpose: input.purpose,
        bytes: normalized.data.length,
        width: normalized.width,
        height: normalized.height,
        checksum: imageHash(normalized.data),
        createdAt: new Date().toISOString(),
      };
      const key = mediaKey(asset);
      await store.set(key, cipher.seal(normalized.data, 'media', key), { onlyIfNew: true });
      const saved = await store.get(key);
      if (saved === null || imageHash(cipher.open(saved, 'media', key)) !== asset.checksum)
        throw new Error('Private media verification failed.');
      state.mediaAssets.push(asset);
      state.adminAudit.push({
        id: randomUUID(),
        orgId: actor.orgId,
        actor: actor.userId,
        action: 'media-uploaded',
        targetId: asset.id,
        at: asset.createdAt,
      });
      return publicMedia(asset);
    },
    async read(state, actor, id) {
      const asset = state.mediaAssets.find(
        (a) => a.id === id && a.orgId === actor.orgId && a.status === 'active',
      );
      if (!asset) throw new AppError('Image not found.', 404);
      const key = mediaKey(asset),
        saved = await store.get(key);
      if (saved === null) throw new Error('Private image unavailable.');
      const data = cipher.open(saved, 'media', key);
      if (imageHash(data) !== asset.checksum)
        throw new Error('Private image integrity check failed.');
      return data;
    },
    hide(state, actor, id) {
      const asset = state.mediaAssets.find((a) => a.id === id && a.orgId === actor.orgId);
      if (!asset) throw new AppError('Image not found.', 404);
      if (asset.status !== 'hidden') {
        asset.status = 'hidden';
        state.adminAudit.push({
          id: randomUUID(),
          orgId: actor.orgId,
          actor: actor.userId,
          action: 'media-hidden',
          targetId: id,
          at: new Date().toISOString(),
        });
      }
      return publicMedia(asset);
    },
  };
}
