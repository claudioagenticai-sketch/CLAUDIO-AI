// Cloud workspace limits, read lazily (tests and Replit Secrets can change them after import).
//
//   CLOUD_DAILY_MESSAGES      chat messages one owner wallet may send per UTC day, all agents together (default 50)
//   CLOUD_MAX_STEPS           model calls one chat turn may make, helpers included (default 6)
//   CLOUD_FILES_MAX           files per agent workspace (default 100)
//   CLOUD_FILE_MAX_BYTES      bytes per file (default 64 KB)
//   CLOUD_FILES_TOTAL_BYTES   bytes per agent workspace (default 1 MB)
//   CLOUD_MEMORY_MAX          memories kept per agent; the oldest unpinned ones go first (default 300)
//   CLOUD_MESSAGES_PER_MIN    chat messages per wallet per minute (default 12)

function num(name: string, def: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : def;
}

export const cloudEnv = {
  dailyMessages: () => num("CLOUD_DAILY_MESSAGES", 50, 0, 100_000),
  maxSteps: () => num("CLOUD_MAX_STEPS", 6, 2, 12),
  maxFiles: () => num("CLOUD_FILES_MAX", 100, 1, 10_000),
  maxFileBytes: () => num("CLOUD_FILE_MAX_BYTES", 64 * 1024, 256, 1024 * 1024),
  maxTotalBytes: () => num("CLOUD_FILES_TOTAL_BYTES", 1024 * 1024, 1024, 50 * 1024 * 1024),
  maxMemories: () => num("CLOUD_MEMORY_MAX", 300, 10, 10_000),
  messagesPerMin: () => num("CLOUD_MESSAGES_PER_MIN", 12, 1, 1000),
};

/** The platform switch (feature_flags) that opens the workspace to non-admin owners. Default off. */
export const CLOUD_FLAG = "cloud_workspace";
