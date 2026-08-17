import * as fs from 'fs';
import * as path from 'path';

// Repo-root `artifacts/` — gitignored except README.md. Calibration scripts
// should prefer writing here instead of polluting tracked `server/data/`.
// Runtime Nest loaders still read `server/data/` only.

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export function artifactsRoot(): string {
  return path.join(REPO_ROOT, 'artifacts');
}

export function serverDataDir(): string {
  return path.join(REPO_ROOT, 'server', 'data');
}

export function ensureArtifactDir(...segments: string[]): string {
  const dir = path.join(artifactsRoot(), ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function artifactPath(...segments: string[]): string {
  return path.join(artifactsRoot(), ...segments);
}
