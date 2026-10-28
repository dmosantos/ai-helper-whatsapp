import { Command, CommanderError } from 'commander';
import { cacheClearCommand, cacheStatusCommand } from './commands/cache.ts';
import { chatsCommand } from './commands/chats.ts';
import { contextCommand } from './commands/context.ts';
import { getCommand } from './commands/get.ts';
import { loginCommand } from './commands/login.ts';
import { memoryCommand } from './commands/memory.ts';
import { searchCommand } from './commands/search.ts';
import { statsCommand } from './commands/stats.ts';
import { transcribeCommand } from './commands/transcribe.ts';
import { CliError, EXIT } from './errors.ts';
import { log } from './log.ts';

const PERIOD_HELP = 'Período: --from/--to (AAAA-MM-DD ou "AAAA-MM-DD HH:mm") ou --last (ex.: 7d, 12h, 2w)';

const program = new Command();
program
  .name('wa-fetch')
  .description('Extrai mensagens do WhatsApp (texto, imagens, documentos e áudio transcrito) com cache local.')
  .exitOverride()
  .showHelpAfterError(false);

program
  .command('login')
  .description('Conecta ao WhatsApp (QR code, só na primeira vez) e salva a sessão')
  .action(loginCommand);

program
  .command('chats')
  .description('Lista conversas (id, nome, tipo). Usa o cache; --live atualiza pelo WhatsApp')
  .option('--search <texto>', 'filtra por parte do nome ou id')
  .option('--live', 'atualiza a lista pelo WhatsApp')
  .option('--offline', 'nunca abre o WhatsApp')
  .option('--limit <n>', 'máximo de linhas', '50')
  .action(chatsCommand);

program
  .command('get')
  .description('Mensagens de um chat. Sem período: DELTA (da última sincronização até agora, máx. 15 dias)')
  .requiredOption('--chat <nome|id>', 'grupo ou pessoa (nome, trecho do nome, telefone ou id)')
  .option('--from <data>', 'início do período')
  .option('--to <data>', 'fim do período (padrão: agora)')
  .option('--last <duração>', 'últimos N minutos/horas/dias/semanas (ex.: 7d)')
  .option('--format <fmt>', 'llm | md | json | csv', 'llm')
  .option('--out <arquivo>', 'grava a saída no arquivo e imprime só o cabeçalho')
  .option('--offline', 'responde só com o cache, sem abrir o WhatsApp')
  .option('--refresh', 'ignora a cobertura e baixa o período de novo')
  .option('--no-transcribe', 'não transcreve áudios')
  .option('--no-media', 'não baixa imagens, documentos e áudios')
  .option('--include-system', 'inclui mensagens de sistema (entrou, saiu, etc.)')
  .option('--max-days <n>', 'janela máxima do delta (padrão: 15)')
  .option('--quiet', 'só sincroniza e imprime um resumo (sem as mensagens)')
  .addHelpText('after', `\n${PERIOD_HELP}`)
  .action(getCommand);

program
  .command('search')
  .description('Busca textual no cache (inclui transcrições). Nunca abre o WhatsApp')
  .requiredOption('--query <texto>', 'termos da busca (todos precisam aparecer; use --any para qualquer um)')
  .option('--chat <nome|id>', 'restringe a um chat')
  .option('--from <data>', 'início')
  .option('--to <data>', 'fim')
  .option('--last <duração>', 'últimos N dias etc.')
  .option('--limit <n>', 'máximo de resultados', '20')
  .option('--any', 'basta um dos termos')
  .option('--format <fmt>', 'llm | md | json | csv', 'llm')
  .action(searchCommand);

program
  .command('context')
  .description('Mensagens ao redor de uma referência m:xxxx (do cache)')
  .requiredOption('--id <m:xxxx>', 'referência da mensagem')
  .option('--before <n>', 'mensagens antes', '10')
  .option('--after <n>', 'mensagens depois', '10')
  .option('--format <fmt>', 'llm | md | json | csv', 'llm')
  .action(contextCommand);

program
  .command('stats')
  .description('Resumo de um chat no cache: volume, autores, cobertura e pendências')
  .requiredOption('--chat <nome|id>', 'grupo ou pessoa')
  .option('--from <data>', 'início')
  .option('--to <data>', 'fim')
  .option('--last <duração>', 'últimos N dias etc.')
  .option('--format <fmt>', 'text | json', 'text')
  .action(statsCommand);

program
  .command('transcribe')
  .description('Transcreve os áudios já baixados que ainda estão pendentes')
  .option('--chat <nome|id>', 'restringe a um chat')
  .action(transcribeCommand);

program
  .command('memory')
  .description('Caminho (e criação, se nova) da memória de análise de um par chat × projeto')
  .requiredOption('--chat <nome|id>', 'grupo ou pessoa')
  .requiredOption('--project <nome>', 'projeto do Azure DevOps')
  .action(memoryCommand);

const cache = program.command('cache').description('Gerencia o cache local');
cache
  .command('status')
  .description('Mostra o que há no cache e as pendências')
  .option('--chat <nome|id>', 'restringe a um chat')
  .action(cacheStatusCommand);
cache
  .command('clear')
  .description('Apaga mensagens, cobertura e mídia de um chat')
  .requiredOption('--chat <nome|id>', 'chat a limpar')
  .option('--keep-media', 'mantém os arquivos de mídia')
  .action(cacheClearCommand);

async function flush(stream: NodeJS.WriteStream): Promise<void> {
  await new Promise<void>((resolve) => stream.write('', () => resolve()));
}

async function main(): Promise<number> {
  try {
    await program.parseAsync(process.argv);
    return EXIT.OK;
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version' || err.code === 'commander.help') return EXIT.OK;
      return EXIT.USAGE;
    }
    if (err instanceof CliError) {
      log(`erro: ${err.message}`);
      return err.code;
    }
    log(`erro inesperado: ${(err as Error).stack ?? err}`);
    return EXIT.GENERAL;
  }
}

const code = await main();
await flush(process.stdout);
await flush(process.stderr);
process.exit(code);
