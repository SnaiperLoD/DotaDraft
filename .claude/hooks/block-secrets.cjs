#!/usr/bin/env node
'use strict';

// PreToolUse (Read): keep secrets out of the agent context. Mirrors .cursor/hooks/block-secrets.cjs.
const fs = require('fs');
const path = require('path');

const input = readJson();
const filePath = String((input.tool_input && input.tool_input.file_path) || '');
const base = path.basename(filePath).toLowerCase();

if (isSecretFile(base)) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Blocked read of ${base}: secrets stay out of the agent context. Use .env.example.`,
      },
    }),
  );
}
process.exit(0);

function isSecretFile(name) {
  if (name === 'credentials.json') return true;
  if (name === '.env') return true;
  if (name.startsWith('.env.') && name !== '.env.example') return true;
  return false;
}

function readJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
