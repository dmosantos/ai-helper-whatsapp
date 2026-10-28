import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.WA_FETCH_DATA ? resolve(process.env.WA_FETCH_DATA) : join(ROOT, 'data');

export const paths = {
  data: DATA_DIR,
  db: join(DATA_DIR, 'wa-fetch.db'),
  session: join(DATA_DIR, 'session'),
  media: join(DATA_DIR, 'media'),
  out: join(DATA_DIR, 'out'),
  qr: join(DATA_DIR, 'qr.png'),
  transcriber: join(ROOT, 'transcriber'),
};

export interface TranscriptionConfig {
  enabled: boolean;
  model: string;
  computeType: string;
  beamSize: number;
  language: string;
  initialPrompt: string;
  threads: number;
}

export interface Config {
  timezone: string;
  /** Janela máxima (dias) do modo delta. */
  maxDays: number;
  /** Acima deste tamanho a saída vai para arquivo em vez do stdout. */
  maxStdoutChars: number;
  /** Documentos maiores que isso (MB) não são baixados. */
  maxDocMB: number;
  browserPath: string;
  startupTimeoutMs: number;
  transcription: TranscriptionConfig;
}

const defaults: Config = {
  timezone: 'America/Sao_Paulo',
  maxDays: 15,
  maxStdoutChars: 60_000,
  maxDocMB: 50,
  browserPath: '',
  startupTimeoutMs: 120_000,
  transcription: {
    enabled: true,
    // Medido em CPU (12 núcleos, int8): small ≈ 0,35× a duração do áudio; large-v3-turbo ≈ 1,3×.
    model: 'small',
    computeType: 'int8',
    beamSize: 1,
    language: 'pt',
    initialPrompt: '',
    threads: 0,
  },
};

let cached: Config | undefined;

/** Lê `wa-fetch.config.json` (opcional, na raiz do projeto) por cima dos padrões. */
export function loadConfig(): Config {
  if (cached) return cached;
  const file = join(ROOT, 'wa-fetch.config.json');
  let user: Partial<Config> = {};
  if (existsSync(file)) {
    user = JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>;
  }
  cached = {
    ...defaults,
    ...user,
    transcription: { ...defaults.transcription, ...(user.transcription ?? {}) },
  };
  return cached;
}

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

export function findBrowser(cfg: Config): string | undefined {
  if (cfg.browserPath && existsSync(cfg.browserPath)) return cfg.browserPath;
  return BROWSER_CANDIDATES.find((p) => existsSync(p));
}
