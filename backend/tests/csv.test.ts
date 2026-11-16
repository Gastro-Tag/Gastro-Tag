import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../src/utils/csv';
import { formatDateBR, formatKitchenDateTime } from '../src/utils/dateUtils';
import { calculateDiscard } from '../src/domain/shelfLife';
import { AppError } from '../src/utils/errors';

describe('CSV', () => {
  it('põe cada célula entre aspas e duplica as aspas internas', () => {
    expect(csvCell('Ana "Chefe"')).toBe('"Ana ""Chefe"""');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('')).toBe('""');
  });

  it('neutraliza células que a planilha leria como fórmula', () => {
    for (const start of ['=', '+', '-', '@', '\t', '\r']) {
      expect(csvCell(`${start}1+1`)).toBe(`"'${start}1+1"`);
    }
    expect(csvCell('1=1')).toBe('"1=1"');
  });

  it('começa com BOM, separa por ponto e vírgula e termina as linhas com CRLF', () => {
    const csv = toCsv(['A', 'B'], [['1', '2']]);
    expect(csv).toBe('﻿"A";"B"\r\n"1";"2"\r\n');
  });
});

describe('datas no formato brasileiro', () => {
  it('formata data sem horário e instante no fuso da cozinha', () => {
    expect(formatDateBR(new Date('2026-09-03T00:00:00Z'))).toBe('03/09/2026');
    const previous = process.env.KITCHEN_TIME_ZONE;
    process.env.KITCHEN_TIME_ZONE = 'America/Manaus';
    try {
      // 02:30 UTC ainda é o dia anterior em Manaus (UTC−4).
      expect(formatKitchenDateTime(new Date('2026-09-04T02:30:00Z'))).toBe('03/09/2026 22:30');
    } finally {
      if (previous === undefined) delete process.env.KITCHEN_TIME_ZONE;
      else process.env.KITCHEN_TIME_ZONE = previous;
    }
  });
});

describe('limite da data de abertura para trás', () => {
  const base = { shelfLifeDays: 5, capToOriginalExpiry: false, today: '2026-09-10', earliestOpenedAt: '2026-09-08' };

  it('aceita a data mínima e recusa a anterior com a data no texto', () => {
    expect(calculateDiscard({ ...base, openedAt: '2026-09-08' }).discardAt.toISOString().slice(0, 10)).toBe('2026-09-12');
    try {
      calculateDiscard({ ...base, openedAt: '2026-09-07' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(422);
      expect((error as AppError).message).toBe('A data de abertura não pode ser anterior a 08/09/2026.');
    }
  });

  it('sem limite, aceita abertura antiga', () => {
    expect(() => calculateDiscard({ ...base, earliestOpenedAt: null, openedAt: '2026-09-07' })).not.toThrow();
  });
});
