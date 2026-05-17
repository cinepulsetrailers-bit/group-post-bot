// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

type Captured = { error: unknown; at: number };

let lastCapturedError: Captured | undefined;
const recent: Captured[] = [];
const MAX_RECENT = 10;
const TTL_MS = 5_000;

function record(error: unknown) {
  const entry = { error, at: Date.now() };
  lastCapturedError = entry;
  recent.push(entry);
  if (recent.length > MAX_RECENT) recent.shift();
  // Always log immediately so the stack appears in worker logs even if no
  // request handler ever consumes it.
  try {
    console.error("[ssr-capture]", formatError(error));
  } catch {
    /* ignore */
  }
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeStr = cause ? `\nCaused by: ${formatError(cause)}` : "";
    return `${error.name}: ${error.message}\n${error.stack ?? "(no stack)"}${causeStr}`;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}

export function drainRecentErrors(): unknown[] {
  const now = Date.now();
  const fresh = recent.filter((e) => now - e.at <= TTL_MS).map((e) => e.error);
  recent.length = 0;
  return fresh;
}
