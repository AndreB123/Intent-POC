type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, message: string, details?: unknown): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] ${level.toUpperCase()}`;

  if (details === undefined) {
    console.log(`${prefix} ${message}`);
    return;
  }

  console.log(`${prefix} ${message}`);
  console.log(JSON.stringify(details, null, 2));
}

export const log = {
  info(message: string, details?: unknown): void {
    write("info", message, details);
  },
  warn(message: string, details?: unknown): void {
    write("warn", message, details);
  },
  error(message: string, details?: unknown): void {
    write("error", message, details);
  }
};