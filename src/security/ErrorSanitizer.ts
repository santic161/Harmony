// Patterns that look like API keys, tokens, or credentials in error messages.
const SECRET_PATTERNS: readonly RegExp[] = [
  /AIza[0-9A-Za-z\-_]{35}/g,          // Google / Gemini API key
  /sk-[A-Za-z0-9]{20,}/g,              // OpenAI / Anthropic sk- style
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, // Generic Bearer token
  /key[=:]["']?[A-Za-z0-9\-_]{16,}/gi, // key=VALUE / key:"VALUE"
  /token[=:]["']?[A-Za-z0-9\-_]{16,}/gi,
  /password[=:]["']?[^\s"'&]{8,}/gi,
  /secret[=:]["']?[^\s"'&]{8,}/gi,
];

export const sanitizeErrorMessage = (msg: string): string => {
  let out = msg;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, '[REDACTED]');
  }
  return out;
};

export const safeUserErrorMessage = (err: unknown): string => {
  const raw = err instanceof Error ? err.message : String(err);
  // Give users a generic message — never expose raw provider errors to the channel.
  // Specific error types get human-friendly descriptions.
  if (raw.includes('timeout') || raw.includes('timed out')) {
    return 'The request timed out. Please try again.';
  }
  if (raw.includes('400') || raw.includes('Bad Request')) {
    return 'Could not process the request. Please try again or rephrase your topic.';
  }
  if (raw.includes('401') || raw.includes('403') || raw.includes('API key')) {
    return 'There is a configuration issue on our end. Please contact the administrator.';
  }
  if (raw.includes('429') || raw.includes('quota') || raw.includes('rate')) {
    return 'Too many requests right now. Please wait a moment and try again.';
  }
  if (raw.includes('500') || raw.includes('502') || raw.includes('503')) {
    return 'The AI service is temporarily unavailable. Please try again in a few minutes.';
  }
  return 'Something went wrong. Please try again.';
};
