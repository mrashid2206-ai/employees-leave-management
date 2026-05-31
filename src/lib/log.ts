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

export const logger = {
  info: (msg: string, meta?: Meta) => emit('info', msg, meta),
  warn: (msg: string, meta?: Meta) => emit('warn', msg, meta),
  error: (msg: string, err?: unknown, meta?: Meta) =>
    emit('error', msg, { ...(meta || {}), error: err instanceof Error ? err.message : err ? String(err) : undefined }),
}
