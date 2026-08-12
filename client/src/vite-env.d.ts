/// <reference types="vite/client" />

// Pulls in Vite's ImportMetaEnv types. Added when App.tsx started gating the
// testing-only /debug route on import.meta.env.DEV — without this reference
// TypeScript doesn't know `import.meta.env` exists at all.
