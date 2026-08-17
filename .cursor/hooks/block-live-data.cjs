#!/usr/bin/env node
'use strict';

const fs = require('fs');

// Live / external snapshot pipelines from calibration-governance.mdc.
// Local `npm run seed` from already-present server/data files is allowed.
const LIVE_DATA = [
  'fetch-hero-meta',
  'refetch-incomplete-hero-meta',
  'recompute-presumed-positions',
  'fetch-pro-matches',
  'calibrate-evaluation-values',
  'calibrate-battle-engine',
  'fetch-deaths-camps-data',
  'fetch-farm-elasticity-data',
  'fetch-lane-fight-data',
];

const input = readJson();
const command = String(input.command || '');
const hit = LIVE_DATA.find((name) => command.toLowerCase().includes(name));

if (hit) {
  process.stdout.write(
    JSON.stringify({
      permission: 'ask',
      user_message: `Live data pipeline "${hit}" needs confirmation. Local seed from existing snapshots is fine.`,
      agent_message:
        'This command refetches or recomputes from live/external match data. Do not run it unless Nick explicitly asked. Local npm run seed from server/data is allowed.',
    }),
  );
  process.exit(0);
}

process.stdout.write(JSON.stringify({ permission: 'allow' }));

function readJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
