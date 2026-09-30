import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dataDir, db } from '../db.ts';

// Sao lưu database SQLite bằng VACUUM INTO (an toàn khi server đang chạy).

export const backupDir = process.env.BACKUP_DIR ?? `${dataDir}backups/`;
const KEEP = Number(process.env.BACKUP_KEEP ?? 30);
const DAY_MS = 24 * 60 * 60 * 1000;

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

export function createBackup(): string {
  mkdirSync(backupDir, { recursive: true });
  const file = `${backupDir}app-${stamp()}.db`;
  db.prepare('VACUUM INTO ?').run(file);
  // Giữ lại KEEP bản mới nhất.
  const files = readdirSync(backupDir)
    .filter((f) => /^app-.*\.db$/.test(f))
    .sort()
    .reverse();
  for (const old of files.slice(KEEP)) rmSync(`${backupDir}${old}`);
  return file;
}

export function listBackups() {
  mkdirSync(backupDir, { recursive: true });
  return readdirSync(backupDir)
    .filter((f) => /^app-.*\.db$/.test(f))
    .sort()
    .reverse()
    .map((name) => ({ name, size: statSync(`${backupDir}${name}`).size }));
}

export function backupPath(name: string) {
  if (!/^app-[\d-]+\.db$/.test(name)) return null;
  return listBackups().some((b) => b.name === name) ? `${backupDir}${name}` : null;
}

/** Sao lưu lúc khởi động (nếu bản gần nhất đã cũ hơn 1 ngày) và mỗi ngày một lần. */
export function scheduleBackups() {
  const latest = listBackups()[0];
  const latestAge = latest ? Date.now() - statSync(`${backupDir}${latest.name}`).mtimeMs : Infinity;
  if (latestAge > DAY_MS) createBackup();
  setInterval(() => {
    try {
      createBackup();
    } catch (err) {
      console.error('Sao lưu thất bại:', err);
    }
  }, DAY_MS).unref();
}
