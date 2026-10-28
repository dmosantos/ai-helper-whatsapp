# wa-fetch

CLI em Node/TypeScript que lê conversas do WhatsApp (via [`whatsapp-web.js`](https://github.com/wwebjs/whatsapp-web.js)) e mantém um **cache local em SQLite**, com download de mídia e **transcrição local de áudio** ([faster-whisper](https://github.com/SYSTRAN/faster-whisper)).

Foi pensado para ser usado por **agentes de IA** (por exemplo, o Claude Code): a saída é previsível, nunca faz perguntas interativas e separa dados (`stdout`) de progresso e erros (`stderr`). Mas funciona bem como ferramenta de linha de comando para humanos também.

> **Aviso:** usa o WhatsApp Web de forma **não oficial**. O uso é somente leitura, no número do próprio usuário. Isso pode contrariar os termos de uso do WhatsApp; use por sua conta e risco. Este projeto não tem qualquer vínculo com o WhatsApp ou a Meta.

## O que faz

- **Sincronização incremental:** `get` baixa só o que ainda não está no cache (modo *delta*), registrando os intervalos já cobertos por chat.
- **Cache local em SQLite** com busca full-text (`search`), que nunca abre o WhatsApp.
- **Mídia:** baixa documentos, imagens e áudios; vídeos e stickers ficam só como metadados.
- **Transcrição de áudio local** (CPU, sem enviar nada para a nuvem) e indexada na busca.
- **Formatos de saída:** `llm` (compacto, ideal para agentes), `md`, `json` e `csv`.
- **Memória de análise** por par chat × projeto, usada por agentes para guardar contexto, demandas e decisões entre execuções.

## Requisitos

- Node.js em versão recente (desenvolvido com Node 24)
- Google Chrome ou Microsoft Edge instalado (usado pelo `whatsapp-web.js`)
- [`uv`](https://docs.astral.sh/uv/) para a transcrição de áudio (o Python é gerenciado por ele em `transcriber/.venv`)
  - Windows: `winget install astral-sh.uv`

## Instalação

```bash
git clone https://github.com/dmosantos/ai-helper-whatsapp.git
cd ai-helper-whatsapp
npm install
npm link          # expõe o comando `wa-fetch` no PATH
```

Para a transcrição, o `uv` instala as dependências Python automaticamente na primeira execução.

## Uso

```bash
wa-fetch login                      # único passo humano: lê o QR e salva a sessão em data/session
wa-fetch chats --search "equipe"    # resolve nomes de chats para ids (--live consulta o WhatsApp)

wa-fetch get --chat "Equipe"        # DELTA: da última sincronização até agora (máx. 15 dias)
wa-fetch get --chat "Equipe" --from 2026-10-01 --to 2026-10-25
wa-fetch get --chat "Equipe" --last 7d --format md --out relatorio.md

wa-fetch search --query "deploy"    # busca no cache, inclusive nas transcrições
wa-fetch context --id m:a1b2c3 --before 10 --after 10
wa-fetch stats --chat "Equipe"
wa-fetch transcribe --chat "Equipe"

wa-fetch memory --chat "Equipe" --project MeuProjeto
wa-fetch cache status
wa-fetch cache clear --chat "Equipe"
```

Flags úteis do `get`: `--offline` (só cache), `--refresh` (ignora a cobertura), `--no-transcribe`, `--no-media`, `--include-system`, `--max-days`, `--quiet`.

### Contrato de saída

- `stdout` traz os dados; `stderr` traz progresso e erros. O CLI nunca pergunta nada.
- Saídas maiores que `maxStdoutChars` (padrão 60 mil) ou pedidas com `--out` vão para arquivo em `data/out/`; o `stdout` mostra só o cabeçalho e o caminho.
- Códigos de saída:

| Código | Significado |
| --- | --- |
| `0` | ok |
| `1` | erro geral |
| `2` | chat ambíguo (os candidatos vão para o `stderr`) |
| `3` | chat não encontrado |
| `4` | sessão ausente ou expirada (rode `wa-fetch login`) |
| `5` | WhatsApp indisponível |
| `64` | uso inválido |

- Formato `llm`: um cabeçalho `# ...` (chat, período, cobertura, autores e **avisos**) seguido de linhas `[m:xxxxxx] HH:mm Autor ↳m:yyyyyy: texto`. Imagens e documentos aparecem com o caminho absoluto; áudios já vêm transcritos.

## Como o cache funciona

- A tabela `coverage` guarda os intervalos já baixados por inteiro, por chat. O `get` calcula `período − cobertura` e só abre o WhatsApp se houver lacuna ou mídia pendente.
- No modo delta, o intervalo é `[última cobertura + 1, agora]`, limitado a `maxDays` (15). Se a última sincronização for mais antiga, baixa só os últimos 15 dias e avisa sobre o buraco.
- A mídia fica em `data/media/<chat>/`, com status por mensagem: `pending`, `downloaded`, `failed` ou `skipped`.
- As referências `m:xxxxxx` derivam do id da mensagem, então continuam válidas mesmo após `cache clear`.

## Memória de análise

`data/memory/<chat>-<id>__<projeto>.md` (mais um `INDEX.md`) guarda, por par chat × projeto: contexto e glossário, regras do usuário, histórico de análises, demandas (`D-001`…, com status, evidências e work items), decisões e pendências.

O cabeçalho `analisado_ate` é a marca d'água da análise e é **diferente** da cobertura do cache: baixado não é o mesmo que analisado. O CLI só resolve o nome do arquivo e cria o template; quem lê e atualiza o conteúdo é o agente.

## Configuração (opcional)

Crie `wa-fetch.config.json` na raiz do projeto (ele é ignorado pelo git):

```json
{
  "timezone": "America/Sao_Paulo",
  "maxDays": 15,
  "maxStdoutChars": 60000,
  "maxDocMB": 50,
  "transcription": {
    "enabled": true,
    "model": "small",
    "computeType": "int8",
    "beamSize": 1,
    "language": "pt",
    "initialPrompt": "",
    "threads": 0
  }
}
```

Os valores acima são os padrões; informe só o que quiser mudar. `maxDocMB` é o tamanho máximo de documento baixado. Outras chaves: `browserPath` (caminho do Chrome/Edge) e `startupTimeoutMs` (padrão 120000). A variável de ambiente `WA_FETCH_DATA` muda a pasta de dados (padrão `./data`).

Modelos de transcrição: `small` é o padrão (≈ 0,35× a duração do áudio); `large-v3-turbo` é mais preciso, mas leva ≈ 1,3×.

## Privacidade e segurança

- `data/` contém a **sessão do WhatsApp e as suas conversas**. Nunca versione essa pasta (ela já está no `.gitignore`).
- Tudo roda localmente: o cache, a mídia e a transcrição não saem da sua máquina.
- Não compartilhe `data/session` nem arquivos gerados em `data/out/`.

## Desenvolvimento

```bash
npm test            # node:test + tsx
npm run typecheck   # tsc --noEmit
```

Estrutura:

```
bin/            executável (wa-fetch.mjs)
src/cache/      SQLite, cobertura e repositório
src/commands/   um arquivo por comando do CLI
src/wa/         cliente, fetcher e mapper do WhatsApp
src/media/      download de mídia
src/output/     formatos llm/md/json/csv
src/transcribe/ integração com o transcritor
transcriber/    script Python (faster-whisper) gerenciado pelo uv
test/           testes automatizados
```

Notas técnicas:

- `whatsapp-web.js` vem do GitHub (`github:wwebjs/whatsapp-web.js`, commit travado no `package-lock.json`), não do npm: a 1.34.7 do npm quebra com o WhatsApp Web atual (`getChats` falha com um erro minificado). Dá para voltar ao npm quando sair uma versão nova.
- O evento `ready` da biblioteca é intermitente, então o `startClient` também considera o cliente pronto com `authenticated` + `WWebJS` + socket `CONNECTED`. Use `WA_FETCH_DEBUG=1` para logar os eventos do cliente.
- `av` está fixado em `<16` em `transcriber/pyproject.toml`: o faster-whisper 1.2.1 quebra com o `av` 19.
- Chats individuais vêm com id `@lid` (não mais `@c.us`), e menções `@numero` no texto podem não resolver nomes.
- A camada que fala com o WhatsApp real (`src/wa/*` e o download de mídia) não tem teste automatizado; o `mapper.ts` é testado com objetos falsos.

## Licença

[MIT](LICENSE) © 2026 Diego Marques
