type LogMeta = Record<string, unknown>;

const nowIso = (): string => new Date().toISOString();

const formatMeta = (meta?: LogMeta): string => {
  if (!meta) {
    return "";
  }
  return ` ${JSON.stringify(meta)}`;
};

export const logger = {
  info(message: string, meta?: LogMeta): void {
    console.log(`[${nowIso()}] INFO ${message}${formatMeta(meta)}`);
  },
  warn(message: string, meta?: LogMeta): void {
    console.warn(`[${nowIso()}] WARN ${message}${formatMeta(meta)}`);
  },
  error(message: string, meta?: LogMeta): void {
    console.error(`[${nowIso()}] ERROR ${message}${formatMeta(meta)}`);
  }
};
