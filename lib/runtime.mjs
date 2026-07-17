// Phantom — shared runtime state
// Mutable exports set by phantom.mjs, read by lib modules.
// ESM live bindings ensure imports see the latest values.

export const __r = {
  llmInstance: null,
  _config: {},
  setProvider: null,
  PROVIDERS: null,
  PHANTOM_LLM_PROVIDER: "openai",
  ENV: null,
};
