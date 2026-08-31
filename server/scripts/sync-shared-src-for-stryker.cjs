#!/usr/bin/env node
/**
 * Stryker only crawls process.cwd() (server/), so ../shared never enters
 * the sandbox. Copy the shared TypeScript sources into server/shared-src
 * before ProjectReader runs. Do not junction/symlink: on Windows Stryker
 * treats a junction as a single file and copyFile throws EPERM.
 */
const fs = require('fs');
const path = require('path');

function isReparsePoint(target) {
  try {
    fs.readlinkSync(target);
    return true;
  } catch {
    return false;
  }
}

function filterSharedCopy(srcRoot, p) {
  const rel = path.relative(srcRoot, p);
  if (!rel || rel.startsWith('..')) return true;
  const parts = rel.split(path.sep);
  return !parts.includes('node_modules') && !parts.includes('dist');
}

function syncSharedSrcForStryker() {
  const src = path.resolve(__dirname, '../../shared');
  const dest = path.resolve(__dirname, '../shared-src');
  if (!fs.existsSync(src)) {
    throw new Error(`shared package not found at ${src}`);
  }
  if (fs.existsSync(dest)) {
    if (isReparsePoint(dest)) {
      fs.unlinkSync(dest);
    } else {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (p) => filterSharedCopy(src, p),
  });
  return dest;
}

module.exports = { syncSharedSrcForStryker };

if (require.main === module) {
  syncSharedSrcForStryker();
}
