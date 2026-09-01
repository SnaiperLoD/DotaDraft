/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TIP_JAR_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Pulls in Vite's ImportMetaEnv types. Added when App.tsx started gating the
// testing-only /debug route on import.meta.env.DEV — without this reference
// TypeScript doesn't know `import.meta.env` exists at all.
