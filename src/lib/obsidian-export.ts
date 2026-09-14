import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Session } from './providers';
import { buildSessionMarkdown } from './session-export';

export class ObsidianExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObsidianExportError';
  }
}

function vaultRoot(): string {
  const configured = process.env.OBSIDIAN_VAULT_PATH?.trim();
  if (!configured) throw new ObsidianExportError('OBSIDIAN_VAULT_PATH is not configured');
  return path.resolve(configured);
}

function safeSlug(value: string): string {
  const slug = value.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return slug || '思辨报告';
}

function safeRelativePath(session: Session, relativePath?: string): string {
  const requested = (relativePath?.trim() || `思辨报告/${new Date(session.updatedAt).toISOString().slice(0, 10)}-${safeSlug(session.report?.title || session.question)}.md`).replace(/\\/g, '/');
  if (path.isAbsolute(requested) || !requested.toLowerCase().endsWith('.md')) {
    throw new ObsidianExportError('Only Vault-relative .md paths are allowed');
  }
  const root = vaultRoot();
  const target = path.resolve(root, requested);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new ObsidianExportError('Target path must remain inside the configured Obsidian Vault');
  }
  return relative;
}

export async function exportSessionToObsidian(session: Session, relativePath?: string): Promise<{ path: string; backupPath?: string; bytes: number }> {
  const root = vaultRoot();
  const safePath = safeRelativePath(session, relativePath);
  const target = path.join(root, safePath);
  await mkdir(path.dirname(target), { recursive: true });
  let backupPath: string | undefined;
  try {
    const existing = await readFile(target);
    backupPath = `${target}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    await rename(target, backupPath);
    void existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const markdown = buildSessionMarkdown(session);
  await writeFile(target, markdown, 'utf8');
  return { path: target, ...(backupPath ? { backupPath } : {}), bytes: Buffer.byteLength(markdown, 'utf8') };
}
