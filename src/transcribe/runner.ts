import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import type { Db } from '../cache/db.ts';
import { setTranscription, type MessageRow } from '../cache/repo.ts';
import { loadConfig, paths } from '../config.ts';
import { log } from '../log.ts';

export interface TranscribeResult {
  done: number;
  empty: number;
  failed: number;
  /** `uv`/Python indisponível: nada foi processado e os áudios continuam pendentes. */
  unavailable: boolean;
}

export function uvAvailable(): boolean {
  const r = spawnSync('uv', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' });
  return r.status === 0;
}

/** Transcreve `rows` (áudios já baixados) e grava o resultado no cache. */
export async function transcribeRows(db: Db, rows: MessageRow[]): Promise<TranscribeResult> {
  const result: TranscribeResult = { done: 0, empty: 0, failed: 0, unavailable: false };
  const cfg = loadConfig().transcription;
  const todo = rows.filter((r) => r.media_path);
  if (todo.length === 0) return result;
  if (!cfg.enabled || !uvAvailable()) {
    result.unavailable = true;
    return result;
  }

  log(`transcrevendo ${todo.length} áudio(s) com faster-whisper (${cfg.model}, CPU)…`);
  const args = [
    'run',
    '--quiet',
    '--project',
    paths.transcriber,
    'python',
    join(paths.transcriber, 'transcribe.py'),
    '--model', cfg.model,
    '--compute-type', cfg.computeType,
    '--beam-size', String(cfg.beamSize),
    '--language', cfg.language,
    '--threads', String(cfg.threads),
  ];
  if (cfg.initialPrompt) args.push('--initial-prompt', cfg.initialPrompt);

  const child = spawn('uv', args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
      HF_HUB_DISABLE_TELEMETRY: '1',
    },
    shell: false,
  });

  const byId = new Map(todo.map((r) => [r.id, r]));
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    let out: { id: string; text?: string; error?: string };
    try {
      out = JSON.parse(line);
    } catch {
      return;
    }
    if (!byId.has(out.id)) return;
    if (out.error !== undefined) {
      log(`  falha ao transcrever ${out.id}: ${out.error}`);
      setTranscription(db, out.id, { status: 'failed' });
      result.failed++;
    } else if (!out.text) {
      setTranscription(db, out.id, { status: 'empty', model: cfg.model });
      result.empty++;
    } else {
      setTranscription(db, out.id, { status: 'done', text: out.text, model: cfg.model });
      result.done++;
    }
  });

  const exited = new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
  for (const r of todo) child.stdin.write(`${JSON.stringify({ id: r.id, path: r.media_path })}\n`);
  child.stdin.end();

  const code = await exited;
  if (code !== 0) log(`transcritor terminou com código ${code}; áudios não processados continuam pendentes.`);
  return result;
}
