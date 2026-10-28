import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDb } from '../src/cache/db.ts';
import {
  addCoverage,
  buildFtsQuery,
  getCoverage,
  getMessageByShortId,
  lastCovered,
  messagesAround,
  messagesInRange,
  pendingTranscriptions,
  searchMessages,
  setMedia,
  setTranscription,
  upsertChats,
  upsertContacts,
  upsertMessages,
  type MessageInput,
} from '../src/cache/repo.ts';
import { mapMessage } from '../src/wa/mapper.ts';

const CHAT = '120363000000000000@g.us';

function msg(id: string, ts: number, over: Partial<MessageInput> = {}): MessageInput {
  return {
    id: `false_${CHAT}_${id}_5511999990001@c.us`,
    chat_id: CHAT,
    ts,
    author_id: '5511999990001@c.us',
    author_name: 'ana',
    from_me: false,
    type: 'chat',
    body: `mensagem ${id}`,
    stanza: id,
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

function setup() {
  const db = openDb(':memory:');
  upsertChats(db, [{ id: CHAT, name: 'Time Backend', is_group: 1, last_ts: 1000 }]);
  upsertContacts(db, [{ id: '5511999990001@c.us', name: 'Ana Souza', number: '5511999990001' }]);
  return db;
}

describe('cache de mensagens', () => {
  it('upsert é idempotente e preserva mídia/transcrição já gravadas', () => {
    const db = setup();
    const audio = msg('A1', 100, { type: 'ptt', body: null, media_kind: 'audio', duration: 42 });
    assert.deepEqual(upsertMessages(db, [audio]), { inserted: 1, updated: 0 });

    setMedia(db, audio.id, { status: 'downloaded', path: 'C:\\x\\a1.ogg' });
    setTranscription(db, audio.id, { status: 'done', text: 'precisamos do relatório de faturamento', model: 'm' });

    assert.deepEqual(upsertMessages(db, [audio]), { inserted: 0, updated: 1 });
    const [row] = messagesInRange(db, CHAT, 0, 1000);
    assert.equal(row.media_status, 'downloaded');
    assert.equal(row.media_path, 'C:\\x\\a1.ogg');
    assert.equal(row.transcription_status, 'done');
    assert.equal(row.display_name, 'Ana Souza');
  });

  it('short ids são únicos e aceitos com ou sem prefixo m:', () => {
    const db = setup();
    upsertMessages(db, [msg('B1', 10), msg('B2', 20), msg('B3', 30)]);
    const rows = messagesInRange(db, CHAT, 0, 100);
    assert.equal(new Set(rows.map((r) => r.short_id)).size, 3);
    assert.equal(getMessageByShortId(db, `m:${rows[1].short_id}`)[0].id, rows[1].id);
    assert.equal(getMessageByShortId(db, rows[1].short_id.toUpperCase())[0].id, rows[1].id);
  });

  it('messagesInRange respeita o período e esconde mensagens de sistema', () => {
    const db = setup();
    upsertMessages(db, [msg('C1', 10), msg('C2', 20), msg('C3', 30, { type: 'gp2', is_system: true, body: null })]);
    assert.deepEqual(messagesInRange(db, CHAT, 15, 40).map((r) => r.stanza), ['C2']);
    assert.deepEqual(messagesInRange(db, CHAT, 15, 40, true).map((r) => r.stanza), ['C2', 'C3']);
  });

  it('messagesAround devolve vizinhos em ordem', () => {
    const db = setup();
    upsertMessages(db, [msg('D1', 10), msg('D2', 20), msg('D3', 30), msg('D4', 40), msg('D5', 50)]);
    const target = messagesInRange(db, CHAT, 30, 30)[0];
    assert.deepEqual(messagesAround(db, target, 1, 2).map((r) => r.stanza), ['D2', 'D3', 'D4', 'D5']);
  });

  it('pendingTranscriptions só lista áudios baixados e pendentes', () => {
    const db = setup();
    const a = msg('E1', 10, { type: 'ptt', body: null, media_kind: 'audio' });
    const b = msg('E2', 20, { type: 'ptt', body: null, media_kind: 'audio' });
    upsertMessages(db, [a, b]);
    setMedia(db, a.id, { status: 'downloaded', path: 'x.ogg' });
    assert.deepEqual(pendingTranscriptions(db, { chatId: CHAT }).map((r) => r.stanza), ['E1']);
    setTranscription(db, a.id, { status: 'done', text: 'oi' });
    assert.equal(pendingTranscriptions(db, { chatId: CHAT }).length, 0);
  });
});

describe('cobertura no banco', () => {
  it('addCoverage funde intervalos e lastCovered devolve o fim mais recente', () => {
    const db = setup();
    assert.equal(lastCovered(db, CHAT), null);
    addCoverage(db, CHAT, { from: 10, to: 20 });
    addCoverage(db, CHAT, { from: 30, to: 40 });
    addCoverage(db, CHAT, { from: 21, to: 29 });
    assert.deepEqual(getCoverage(db, CHAT), [{ from: 10, to: 40 }]);
    assert.equal(lastCovered(db, CHAT), 40);
  });
});

describe('busca FTS', () => {
  it('ignora acentos, usa prefixo e inclui transcrições', () => {
    const db = setup();
    const audio = msg('F2', 20, { type: 'ptt', body: null, media_kind: 'audio' });
    upsertMessages(db, [msg('F1', 10, { body: 'O relatório de faturamento está lento' }), audio]);
    setMedia(db, audio.id, { status: 'downloaded', path: 'x.ogg' });
    setTranscription(db, audio.id, { status: 'done', text: 'precisamos exportar em excel o faturamento' });

    assert.deepEqual(searchMessages(db, 'relatorio faturamento').map((r) => r.stanza), ['F1']);
    assert.deepEqual(searchMessages(db, 'faturam').map((r) => r.stanza), ['F1', 'F2']);
    assert.deepEqual(searchMessages(db, 'excel relatorio', { any: true }).map((r) => r.stanza), ['F1', 'F2']);
    assert.deepEqual(searchMessages(db, 'excel relatorio').map((r) => r.stanza), []);
  });

  it('buildFtsQuery neutraliza operadores e aspas', () => {
    assert.equal(buildFtsQuery('foo" OR (bar*)'), '"foo"* "OR"* "bar"*');
    assert.equal(buildFtsQuery('   '), '');
  });
});

describe('mapMessage', () => {
  const base = {
    id: { _serialized: `false_${CHAT}_X1_5511999990001@c.us`, id: 'X1' },
    timestamp: 1700000000,
    fromMe: false,
    from: CHAT,
    author: '5511999990001@c.us',
    type: 'chat',
    body: 'olá',
    hasQuotedMsg: false,
    _data: { notifyName: 'Ana' },
  };

  it('mensagem de texto em grupo usa author', () => {
    const m = mapMessage(base, CHAT, '5511888880000@c.us');
    assert.equal(m.author_id, '5511999990001@c.us');
    assert.equal(m.author_name, 'Ana');
    assert.equal(m.body, 'olá');
    assert.equal(m.is_system, false);
  });

  it('mensagem própria usa o meu id', () => {
    const m = mapMessage({ ...base, fromMe: true }, CHAT, '5511888880000@c.us');
    assert.equal(m.author_id, '5511888880000@c.us');
    assert.equal(m.from_me, true);
  });

  it('áudio, resposta e sistema', () => {
    const audio = mapMessage({ ...base, type: 'ptt', body: '', duration: '42', _data: { mimetype: 'audio/ogg; codecs=opus' } }, CHAT, null);
    assert.equal(audio.media_kind, 'audio');
    assert.equal(audio.duration, 42);
    assert.equal(audio.body, null);

    const reply = mapMessage({ ...base, hasQuotedMsg: true, _data: { quotedStanzaID: 'Q9' } }, CHAT, null);
    assert.equal(reply.quoted_stanza, 'Q9');

    assert.equal(mapMessage({ ...base, type: 'gp2', body: '' }, CHAT, null).is_system, true);
    assert.equal(mapMessage({ ...base, type: 'revoked' }, CHAT, null).is_deleted, true);
  });
});
