// Tiny structured (JSON-line) logger. Railway/most platforms capture stdout, so
// one-line JSON is enough — no external agent needed. Use instead of bare console
// in server code so failures carry context.
type Meta = Record<string, unknown>

function emit(level: 'info' | 'warn' | 'error', msg: string, meta?: Meta) {
  const entry: Meta = { level, msg, ...(meta || {}) }
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

// The stack is the part of an error that says WHERE it happened. Logging only the message
// left "connection terminated unexpectedly" with no way to tell which query or route
// raised it.
function describe(err: unknown): Meta {
  if (err instanceof Error) return { error: err.message, stack: err.stack }
  return { error: err ? String(err) : undefined }
}

export const logger = {
  info: (msg: string, meta?: Meta) => emit('info', msg, meta),
  warn: (msg: string, meta?: Meta) => emit('warn', msg, meta),
  error: (msg: string, err?: unknown, meta?: Meta) => emit('error', msg, { ...(meta || {}), ...describe(err) }),
}
