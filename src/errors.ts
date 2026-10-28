export const EXIT = {
  OK: 0,
  GENERAL: 1,
  AMBIGUOUS_CHAT: 2,
  CHAT_NOT_FOUND: 3,
  AUTH: 4,
  UNAVAILABLE: 5,
  USAGE: 64,
} as const;

export class CliError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}
