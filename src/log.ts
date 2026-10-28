/** Diagnóstico e progresso vão para o stderr; o stdout fica só com dados. */
export function log(...args: unknown[]): void {
  console.error(...args);
}
