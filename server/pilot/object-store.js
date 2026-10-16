import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Development/test storage is confined to the chosen ignored pilot directory.
// Hosted code opens only site-scoped Netlify stores after checking site/mode.
export function fileObjectStore(directory) {
  const location = (key) => {
    if (!/^[a-zA-Z0-9_./-]+$/.test(key) || key.includes('..'))
      throw new Error('Invalid object key.');
    return path.join(directory, ...key.split('/'));
  };
  return {
    async get(key) {
      try {
        return await readFile(location(key), 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async set(key, value, { onlyIfNew = false } = {}) {
      const file = location(key);
      await mkdir(path.dirname(file), { recursive: true });
      try {
        await writeFile(file, value, { flag: onlyIfNew ? 'wx' : 'w', mode: 0o600 });
        return { modified: true };
      } catch (error) {
        if (error.code === 'EEXIST') return { modified: false };
        throw error;
      }
    },
    async list({ prefix = '' } = {}) {
      const { readdir } = await import('node:fs/promises');
      try {
        const files = await readdir(directory, { recursive: true, withFileTypes: true });
        return {
          blobs: files
            .filter((f) => f.isFile())
            .map((f) => ({
              key: path.relative(directory, path.join(f.parentPath, f.name)).replaceAll('\\', '/'),
            }))
            .filter((f) => f.key.startsWith(prefix)),
        };
      } catch (error) {
        if (error.code === 'ENOENT') return { blobs: [] };
        throw error;
      }
    },
  };
}
