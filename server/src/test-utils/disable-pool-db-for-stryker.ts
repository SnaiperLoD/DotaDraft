// Stryker-only Jest setupFile. opponent-pool.service.spec.ts's "live
// Postgres regression" describe block runs for real against the shared
// Opponent Pool Postgres (POOL_DATABASE_URL) whenever that var is set, and
// is designed to skip cleanly when it isn't (see the spec file's own
// comment). Stryker's dry run + per-mutant runs execute many concurrent
// jest processes, which raced/timed out against that live DB. Forcing an
// empty string (not deleting the key) stops Prisma's own dotenv fallback
// from refilling it from .env, since dotenv only fills genuinely undefined
// vars.
process.env.POOL_DATABASE_URL = '';
