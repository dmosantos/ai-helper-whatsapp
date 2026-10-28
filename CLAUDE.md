# wa-fetch

CLI Node/TypeScript que lê o WhatsApp (via `whatsapp-web.js`) e mantém um cache local em SQLite, com mídia e transcrição local de áudio (faster-whisper). Foi pensado para ser **usado por um agente (Claude)** — veja a skill `demandas-whatsapp` (`~/.claude/skills/demandas-whatsapp`).

## Uso rápido

```
wa-fetch login                                   # único passo humano (QR); salva sessão em data/session
wa-fetch chats [--search x] [--live]             # resolve nomes → ids
wa-fetch get --chat X                            # DELTA: desde a última sincronização até agora (máx. 15 dias)
wa-fetch get --chat X --from 2026-10-01 --to 2026-10-25 [--last 7d] [--format llm|md|json|csv] [--out arq]
wa-fetch search --query "termo" [--chat X]       # FTS no cache (inclui transcrições), nunca abre o WhatsApp
wa-fetch context --id m:xxxxxx --before 10 --after 10
wa-fetch stats --chat X
wa-fetch transcribe [--chat X]
wa-fetch memory --chat X --project P            # caminho da memória de análise chat × projeto (cria se não existir)
wa-fetch cache status | cache clear --chat X
```

Flags do `get`: `--offline` (só cache), `--refresh` (ignora cobertura), `--no-transcribe`, `--no-media`, `--include-system`, `--max-days`, `--quiet`.

## Contrato de saída (para agentes)

- stdout = dados; stderr = progresso/erros. Nunca pergunta nada (não interativo).
- Saída acima de `maxStdoutChars` (60k) ou com `--out` vai para arquivo; o stdout traz só o cabeçalho + caminho (`data/out/`).
- Códigos de saída: `0` ok · `2` chat ambíguo (stderr lista candidatos) · `3` chat não encontrado · `4` sessão ausente/expirada (rodar `wa-fetch login`) · `5` WhatsApp indisponível · `64` uso inválido · `1` erro geral.
- Formato `llm`: cabeçalho `# ...` (chat, período, cobertura, autores, **avisos**) + linhas `[m:xxxxxx] HH:mm Autor ↳m:yyyyyy: texto`. Imagens/documentos aparecem com caminho absoluto; áudio já transcrito.

## Como o cache funciona

- Tabela `coverage` guarda os intervalos já baixados por inteiro por chat. `get` calcula `período − cobertura` e só abre o WhatsApp se houver lacuna (ou mídia pendente).
- Modo delta (`get` sem período): `[última cobertura+1, agora]`, limitado a `maxDays` (15). Se a última sync for mais antiga, baixa só os últimos 15 dias e avisa o buraco.
- Mídia: documentos, imagens e áudios são baixados (`data/media/<chat>/`); vídeo/sticker só metadados. Status por mensagem: `pending|downloaded|failed|skipped`.
- Transcrição: `transcriber/transcribe.py` via `uv run` (faster-whisper, CPU, int8). Modelo padrão `small` (≈0,35× a duração do áudio); `large-v3-turbo` é mais preciso mas ≈1,3× — troque em `wa-fetch.config.json` → `transcription.model`.

## Memória de análise

`data/memory/<chat>-<id>__<projeto>.md` (+ `INDEX.md`) guarda, por par chat × projeto: contexto/glossário, regras do usuário, histórico de análises, demandas (IDs D-001…, status, evidências, work items), decisões e pendências. O cabeçalho `analisado_ate` é a marca d'água da análise — **diferente** da cobertura do cache (baixado ≠ analisado). Quem lê e atualiza é a skill `demandas-whatsapp`; o CLI só resolve o nome do arquivo e cria o template. As referências `m:xxxxxx` são derivadas do id da mensagem, então continuam válidas mesmo após `cache clear`.

## Configuração (opcional)

`wa-fetch.config.json` na raiz (gitignored): `timezone`, `maxDays`, `maxStdoutChars`, `maxDocMB`, `browserPath`, `startupTimeoutMs`, `transcription: { enabled, model, computeType, beamSize, language, initialPrompt, threads }`.
`WA_FETCH_DATA` muda a pasta de dados (padrão `./data`).

## Desenvolvimento

- `npm test` (node:test + tsx), `npm run typecheck`. O executável é `bin/wa-fetch.mjs` (`npm link` já feito).
- Requer Chrome ou Edge instalado e `uv` (`winget install astral-sh.uv`) para transcrição. Python é gerenciado pelo `uv` em `transcriber/.venv`.
- `av` está fixado em `<16` no `transcriber/pyproject.toml`: faster-whisper 1.2.1 quebra com `av` 19 (`metadata_errors`).
- `whatsapp-web.js` vem do GitHub (`github:wwebjs/whatsapp-web.js`, commit travado no package-lock), não do npm: o 1.34.7 do npm quebra com o WhatsApp Web atual (`getChats` → erro minificado "r: r"). Quando sair versão nova no npm, dá para voltar.
- O evento `ready` da lib é intermitente (o WhatsApp Web navega no meio do `attachEventListeners`). `startClient` também considera o cliente pronto com `authenticated` + `WWebJS` + socket CONNECTED. Depuração: `WA_FETCH_DEBUG=1` loga os eventos do cliente.
- Chats individuais agora vêm com id `@lid` (não mais `@c.us`); menções `@numero` no texto podem não resolver nomes.
- A parte que fala com o WhatsApp real (`src/wa/*`, download de mídia) não tem teste automatizado; `mapper.ts` é testado com objetos falsos.
- Uso não oficial do WhatsApp Web: só leitura, no número do próprio usuário. `data/` contém sessão e conversas — nunca versionar.
