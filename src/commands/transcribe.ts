import { pendingTranscriptions } from '../cache/repo.ts';
import { transcribeRows } from '../transcribe/runner.ts';
import { openApp, resolveChat } from './shared.ts';

export interface TranscribeOptions {
  chat?: string;
}

/** Transcreve os áudios já baixados que ainda estão pendentes no cache. */
export async function transcribeCommand(opts: TranscribeOptions): Promise<void> {
  const app = openApp(true);
  const chat = opts.chat ? await resolveChat(app, opts.chat) : undefined;
  const rows = pendingTranscriptions(app.db, { chatId: chat?.id });
  if (rows.length === 0) {
    process.stdout.write('nenhum áudio pendente de transcrição\n');
    return;
  }
  const r = await transcribeRows(app.db, rows);
  if (r.unavailable) {
    process.stdout.write(`${rows.length} áudio(s) pendentes, mas a transcrição está indisponível (uv/Python não encontrado ou desativada em wa-fetch.config.json)\n`);
    return;
  }
  process.stdout.write(`transcritos: ${r.done}; sem fala: ${r.empty}; falhas: ${r.failed}\n`);
}
