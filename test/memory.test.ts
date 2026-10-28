import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { memoryFileName, memoryTemplate } from '../src/commands/memory.ts';

const chat = { id: '120363401854274902@g.us', name: 'Projeto Faturamento – Time' };

describe('memória de análise', () => {
  it('nome de arquivo é determinístico e distingue chat e projeto', () => {
    assert.equal(memoryFileName(chat, 'Faturamento Web'), 'projeto-faturamento-time-274902__faturamento-web.md');
    assert.equal(memoryFileName(chat, 'Faturamento Web'), memoryFileName(chat, 'faturamento  web'));
    assert.notEqual(memoryFileName(chat, 'A'), memoryFileName(chat, 'B'));
    assert.notEqual(memoryFileName(chat, 'A'), memoryFileName({ ...chat, id: '120363000000999999@g.us' }, 'A'));
  });

  it('template traz as seções e o cabeçalho com marca d\'água', () => {
    const t = memoryTemplate(chat, 'Faturamento Web', '2026-10-26');
    assert.match(t, /^---\nchat: Projeto Faturamento – Time\nchat_id: 120363401854274902@g\.us\nprojeto: Faturamento Web/);
    assert.match(t, /analisado_ate: nunca/);
    for (const h of ['## Contexto e glossário', '## Regras e preferências do usuário', '## Análises realizadas', '## Demandas', '## Decisões', '## Pendências e perguntas em aberto']) {
      assert.ok(t.includes(h), h);
    }
  });
});
