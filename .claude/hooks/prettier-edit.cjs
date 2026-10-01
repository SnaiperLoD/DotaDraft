#!/usr/bin/env node
'use strict';

// PostToolUse (Edit|Write): format the edited file with the repo's prettier. Fails open.
// Mirrors .cursor/hooks/prettier-edit.cjs.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const EXTS = new Set(['.ts', '.tsx', '.js', '.cjs', '.css', '.json', '.yml', '.yaml', '.html']);

const input = readJson();
const filePath = String((input.tool_input && input.tool_input.file_path) || '');
if (!filePath) process.exit(0);

const ext = path.extname(filePath).toLowerCase();
const base = path.basename(filePath);
if (!EXTS.has(ext) || base === 'package-lock.json' || !fs.existsSync(filePath)) {
  process.exit(0);
}

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const prettierBin = path.join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
if (!fs.existsSync(prettierBin)) process.exit(0);

try {
  execFileSync(process.execPath, [prettierBin, '--write', '--ignore-unknown', filePath], {
    cwd: root,
    stdio: 'ignore',
    timeout: 15000,
  });
} catch {
  // A formatter miss must not block the agent.
}
process.exit(0);

function readJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
