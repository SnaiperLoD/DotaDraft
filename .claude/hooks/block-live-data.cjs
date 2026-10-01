#!/usr/bin/env node
'use strict';

// PreToolUse (Bash|PowerShell): ask before live/external data pipelines
// (Real-Data Recompute Rule, Blueprint/01-core-rules.md). Mirrors .cursor/hooks/block-live-data.cjs.
const fs = require('fs');

const LIVE_DATA = [
  'fetch-hero-meta',
  'refetch-incomplete-hero-meta',
  'recompute-presumed-positions',
  'fetch-pro-matches',
  'calibrate-evaluation-values',
  'calibrate-battle-engine',
  'compute-axis-percentiles',
  'fetch-deaths-camps-data',
  'fetch-farm-elasticity-data',
  'fetch-lane-fight-data',
  'api.opendota.com',
];

const input = readJson();
const command = String((input.tool_input && input.tool_input.command) || '').toLowerCase();
const hit = LIVE_DATA.find((name) => command.includes(name));

if (hit) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `Live data pipeline "${hit}" refetches or recomputes from external match data. Run only if the author explicitly asked; local npm run seed is fine.`,
      },
    }),
  );
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
