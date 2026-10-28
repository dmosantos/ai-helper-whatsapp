import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeDelta, mergeIntervals, subtractIntervals } from '../src/cache/coverage.ts';

describe('mergeIntervals', () => {
  it('funde sobrepostos e adjacentes', () => {
    assert.deepEqual(
      mergeIntervals([
        { from: 10, to: 20 },
        { from: 21, to: 30 },
        { from: 5, to: 12 },
        { from: 100, to: 110 },
      ]),
      [
        { from: 5, to: 30 },
        { from: 100, to: 110 },
      ],
    );
  });

  it('ignora intervalos invertidos', () => {
    assert.deepEqual(mergeIntervals([{ from: 10, to: 5 }]), []);
  });
});

describe('subtractIntervals', () => {
  it('sem cobertura devolve o intervalo inteiro', () => {
    assert.deepEqual(subtractIntervals({ from: 0, to: 100 }, []), [{ from: 0, to: 100 }]);
  });

  it('cobertura total não deixa lacunas', () => {
    assert.deepEqual(subtractIntervals({ from: 10, to: 20 }, [{ from: 0, to: 50 }]), []);
  });

  it('lacunas nas pontas e no meio', () => {
    assert.deepEqual(
      subtractIntervals({ from: 0, to: 100 }, [
        { from: 20, to: 30 },
        { from: 50, to: 60 },
      ]),
      [
        { from: 0, to: 19 },
        { from: 31, to: 49 },
        { from: 61, to: 100 },
      ],
    );
  });

  it('cobertura fora do intervalo é ignorada', () => {
    assert.deepEqual(subtractIntervals({ from: 50, to: 60 }, [{ from: 0, to: 10 }, { from: 200, to: 300 }]), [{ from: 50, to: 60 }]);
  });

  it('borda exata: cobertura termina em to', () => {
    assert.deepEqual(subtractIntervals({ from: 0, to: 100 }, [{ from: 0, to: 100 }]), []);
    assert.deepEqual(subtractIntervals({ from: 0, to: 100 }, [{ from: 0, to: 99 }]), [{ from: 100, to: 100 }]);
  });
});

describe('computeDelta', () => {
  const DAY = 86400;
  const now = 100 * DAY;

  it('primeira sincronização pega os últimos maxDays', () => {
    const d = computeDelta(null, now, 15);
    assert.deepEqual(d.range, { from: now - 15 * DAY, to: now });
    assert.equal(d.firstSync, true);
    assert.equal(d.truncated, false);
  });

  it('sincronização recente pega só do último ponto até agora', () => {
    const last = now - 2 * DAY;
    const d = computeDelta(last, now, 15);
    assert.deepEqual(d.range, { from: last + 1, to: now });
    assert.equal(d.truncated, false);
    assert.equal(d.skipped, null);
  });

  it('última sincronização além de maxDays trunca e informa o buraco', () => {
    const last = now - 40 * DAY;
    const d = computeDelta(last, now, 15);
    assert.deepEqual(d.range, { from: now - 15 * DAY, to: now });
    assert.equal(d.truncated, true);
    assert.deepEqual(d.skipped, { from: last + 1, to: now - 15 * DAY - 1 });
  });

  it('exatamente no limite não trunca', () => {
    const last = now - 15 * DAY - 1;
    const d = computeDelta(last, now, 15);
    assert.equal(d.truncated, false);
    assert.equal(d.range.from, now - 15 * DAY);
  });
});
