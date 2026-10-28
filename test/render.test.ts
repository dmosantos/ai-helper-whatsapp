import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDb } from '../src/cache/db.ts';
import { messagesInRange, setMedia, setTranscription, upsertChats, upsertContacts, upsertMessages, type MessageInput } from '../src/cache/repo.ts';
import { renderCsv } from '../src/output/csv.ts';
import { renderJson } from '../src/output/json.ts';
import { renderLlm, type RenderMeta } from '../src/output/render.ts';
import { quotedMap } from '../src/commands/shared.ts';
import { parseInstant, resolvePeriod } from '../src/period.ts';

const CHAT = '120363000000000000@g.us';
const TZ = 'America/Sao_Paulo';

function input(stanza: string, ts: number, over: Partial<MessageInput> = {}): MessageInput {
  return {
    id: `false_${CHAT}_${stanza}_a@c.us`,
    chat_id: CHAT,
    ts,
    author_id: 'a@c.us',
    author_name: null,
    from_me: false,
    type: 'chat',
    body: stanza,
    stanza,
    quoted_stanza: null,
    is_system: false,
    is_edited: false,
    is_deleted: false,
    is_forwarded: false,
    media_kind: null,
    media_mime: null,
    media_filename: null,
    media_size: null,
    duration: null,
    ...over,
  };
}

const t0 = parseInstant('2026-10-03 09:14', TZ);

function fixture() {
  const db = openDb(':memory:');
  upsertChats(db, [{ id: CHAT, name: 'Projeto Faturamento', is_group: 1, last_ts: t0 }]);
  upsertContacts(db, [
    { id: 'a@c.us', name: 'Ana Souza', number: '5511999990001' },
    { id: 'me@c.us', pushname: 'Diego', number: '5511888880000' },
  ]);
  const audio = input('A', t0 + 360, { type: 'ptt', body: null, media_kind: 'audio', duration: 42 });
  const image = input('I', t0 + 1020, { type: 'image', body: 'print do erro', media_kind: 'image' });
  const doc = input('D', t0 + 1740, { type: 'document', body: null, media_kind: 'document', media_filename: 'spec_v2.pdf', author_id: 'me@c.us', from_me: true });
  upsertMessages(db, [
    input('T1', t0, { body: 'Precisamos do centro de custo no relatório de @5511999990001' }),
    input('T2', t0 + 120, { body: 'É para o fechamento?\nSim.', quoted_stanza: 'T1' }),
    audio,
    image,
    doc,
    input('T3', t0 + 86400 * 2, { body: 'na verdade é dia 28', is_edited: true, is_forwarded: true }),
  ]);
  setMedia(db, audio.id, { status: 'downloaded', path: 'C:\\data\\a.ogg' });
  setTranscription(db, audio.id, { status: 'done', text: 'sim, e exportar em excel', model: 'm' });
  setMedia(db, image.id, { status: 'downloaded', path: 'C:\\data\\i.jpg' });
  setMedia(db, doc.id, { status: 'downloaded', path: 'C:\\data\\spec_v2.pdf' });
  return db;
}

const meta = (db: ReturnType<typeof fixture>): RenderMeta => ({
  chat: { id: CHAT, name: 'Projeto Faturamento', is_group: 1 },
  from: t0 - 60,
  to: t0 + 86400 * 3,
  tz: TZ,
  mode: 'período',
  coverage: 'completa',
  warnings: [],
});

describe('renderLlm', () => {
  const db = fixture();
  const rows = messagesInRange(db, CHAT, 0, t0 + 86400 * 5);
  const text = renderLlm(rows, meta(db), { quoted: quotedMap(db, rows), mentions: new Map([['5511999990001', 'Ana Souza']]) });

  it('cabeçalho traz chat, período, contagens e autores', () => {
    assert.match(text, /^# chat: Projeto Faturamento \(grupo, 1203630/);
    assert.match(text, /# período: 2026-10-03 09:13 → 2026-10-06 09:14 \(America\/Sao_Paulo\) \| modo: período/);
    assert.match(text, /msgs: 6 \| áudios: 1 \(1 transcritos\) \| imagens: 1 \| documentos: 1/);
    assert.match(text, /# autores: Ana Souza \(5\), Diego \(eu\) \(1\)/);
    assert.match(text, /# avisos: nenhum/);
  });

  it('agrupa por dia com dia da semana e linhas com ref estável', () => {
    assert.match(text, /## 2026-10-03 \(sáb\)/);
    assert.match(text, /## 2026-10-05 \(seg\)/);
    assert.match(text, /\[m:[0-9a-f]{6}\] 09:14 Ana Souza: Precisamos/);
  });

  it('resolve menções, respostas e multilinha', () => {
    assert.match(text, /relatório de @Ana Souza/);
    assert.match(text, /09:16 Ana Souza ↳m:[0-9a-f]{6}: É para o fechamento\?\n {4}Sim\./);
  });

  it('mídia: áudio transcrito, imagem e documento com caminho; marcadores', () => {
    assert.match(text, /Ana Souza: 🎤0:42 "sim, e exportar em excel"/);
    assert.match(text, /🖼 "print do erro" → C:\\data\\i\.jpg/);
    assert.match(text, /Diego \(eu\): 📎 spec_v2\.pdf → C:\\data\\spec_v2\.pdf/);
    assert.match(text, /Ana Souza \[encaminhada\] \[editada\]: na verdade é dia 28/);
  });

  it('áudio sem transcrição aparece com aviso e caminho', () => {
    const db2 = fixture();
    const a = messagesInRange(db2, CHAT, 0, t0 + 1000).find((r) => r.media_kind === 'audio')!;
    db2.prepare("UPDATE messages SET transcription_status='pending', transcription=NULL WHERE id=?").run(a.id);
    const out = renderLlm(messagesInRange(db2, CHAT, 0, t0 + 1000), meta(db2));
    assert.match(out, /🎤0:42 \[não transcrito\] C:\\data\\a\.ogg/);
  });
});

describe('json e csv', () => {
  const db = fixture();
  const rows = messagesInRange(db, CHAT, 0, t0 + 86400 * 5);

  it('json traz meta e mensagens com reply_to e mídia', () => {
    const parsed = JSON.parse(renderJson(rows, meta(db), { quoted: quotedMap(db, rows) }));
    assert.equal(parsed.meta.count, 6);
    assert.match(parsed.messages[1].reply_to, /^m:[0-9a-f]{6}$/);
    assert.equal(parsed.messages[2].transcription, 'sim, e exportar em excel');
    assert.equal(parsed.messages[4].media.filename, 'spec_v2.pdf');
  });

  it('csv escapa aspas, vírgulas e quebras de linha', () => {
    const csv = renderCsv(rows, meta(db), { quoted: quotedMap(db, rows) });
    const lines = csv.split('\r\n');
    assert.equal(lines[0], 'ref,datetime,author,from_me,type,text,reply_to,media_path,transcription');
    assert.match(csv, /"É para o fechamento\?\nSim\."/);
  });
});

describe('períodos', () => {
  it('parseInstant respeita o fuso (UTC-3)', () => {
    assert.equal(parseInstant('2026-10-01', TZ), Date.UTC(2026, 9, 1, 3, 0, 0) / 1000);
    assert.equal(parseInstant('01/10/2026', TZ), parseInstant('2026-10-01', TZ));
    assert.equal(parseInstant('2026-10-01', TZ, true), parseInstant('2026-10-01 23:59:59', TZ));
  });

  it('resolvePeriod: --last, --from/--to e delta (null)', () => {
    const now = 1_800_000_000;
    assert.deepEqual(resolvePeriod({ last: '7d' }, TZ, now), { from: now - 7 * 86400, to: now });
    assert.equal(resolvePeriod({}, TZ, now), null);
    assert.throws(() => resolvePeriod({ from: '2026-10-05', to: '2026-10-01' }, TZ, now), /posterior/);
    assert.throws(() => resolvePeriod({ last: '7d', from: '2026-10-01' }, TZ, now), /não os dois/);
  });
});
