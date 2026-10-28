import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatRow } from '../cache/repo.ts';
import { paths } from '../config.ts';
import { CliError, EXIT } from '../errors.ts';
import { slugify, ymd } from '../fmt.ts';
import { openApp, resolveChat } from './shared.ts';

export const memoryDir = (): string => join(paths.data, 'memory');

/** Um arquivo por par chat × projeto; o sufixo do id evita colisão entre chats de mesmo nome. */
export function memoryFileName(chat: Pick<ChatRow, 'id' | 'name'>, project: string): string {
  const tail = chat.id.split('@')[0].slice(-6);
  return `${slugify(chat.name ?? chat.id)}-${tail}__${slugify(project)}.md`;
}

export function memoryTemplate(chat: Pick<ChatRow, 'id' | 'name'>, project: string, today: string): string {
  const name = chat.name ?? chat.id;
  return `---
chat: ${name}
chat_id: ${chat.id}
projeto: ${project}
criado: ${today}
atualizado: ${today}
analisado_ate: nunca   # AAAA-MM-DD HH:mm (fuso do CLI) da última mensagem efetivamente analisada
---

# Memória: ${name} × ${project}

> Contexto acumulado entre análises. É apoio, não verdade absoluta: se o que está aqui divergir da conversa ou do backlog atuais, vale o atual — e registre a divergência.
> Referências \`m:xxxxxx\` são estáveis (derivadas do id da mensagem) e valem mesmo depois de limpar o cache.

## Contexto e glossário
<!-- Quem é quem, apelidos de sistemas/telas/relatórios, termos do domínio que ajudam a casar demanda com PBI/bug. -->

## Regras e preferências do usuário
<!-- Ex.: ignorar mensagens de fulano; "ajuste" aqui significa PBI; área/iteração padrão; formato do relatório. -->

## Análises realizadas
| # | Feita em | Período analisado | Msgs | Resumo do resultado |
|---|---|---|---|---|

## Demandas
<!-- Status: sem-item | coberta | parcial | entregue | a-confirmar | atendida-na-conversa | descartada -->
| ID | Título | Solicitante | Pedida em | Evidências | Status | Work items | Verificado em | Notas |
|---|---|---|---|---|---|---|---|---|

## Decisões
<!-- AAAA-MM-DD — decisão (quem decidiu, por quê). Ex.: "D-004 descartada: pedido cancelado pela Ana em m:ab12cd". -->

## Pendências e perguntas em aberto
<!-- O que ficou para confirmar com alguém ou verificar na próxima análise. -->
`;
}

function updateIndex(dir: string, file: string, line: string): void {
  const index = join(dir, 'INDEX.md');
  const header = '# Memórias de análise (chat × projeto)\n\n';
  const current = existsSync(index) ? readFileSync(index, 'utf8') : header;
  if (current.includes(`(${file})`)) return;
  writeFileSync(index, `${current.endsWith('\n') ? current : `${current}\n`}- [${file}](${file}) — ${line}\n`, 'utf8');
}

export interface MemoryOptions {
  chat: string;
  project: string;
}

/**
 * Imprime o caminho do arquivo de memória do par chat × projeto, criando-o a partir do template
 * se ainda não existir. Só usa o cache (nunca abre o WhatsApp).
 */
export async function memoryCommand(opts: MemoryOptions): Promise<void> {
  if (!opts.project.trim()) throw new CliError(EXIT.USAGE, '--project não pode ser vazio.');
  const app = openApp(true);
  const chat = await resolveChat(app, opts.chat);
  const dir = memoryDir();
  mkdirSync(dir, { recursive: true });

  const file = memoryFileName(chat, opts.project);
  const full = join(dir, file);
  const isNew = !existsSync(full);
  if (isNew) {
    const today = ymd(Math.floor(Date.now() / 1000), app.cfg.timezone);
    writeFileSync(full, memoryTemplate(chat, opts.project, today), 'utf8');
    updateIndex(dir, file, `${chat.name ?? chat.id} × ${opts.project}`);
  }
  process.stdout.write(`${full}\n# ${isNew ? 'memória nova (template criado)' : 'memória existente: leia antes de buscar mensagens'}\n`);
}
