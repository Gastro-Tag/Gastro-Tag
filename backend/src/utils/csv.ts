// Planilha aberta no Excel/LibreOffice em pt-BR: separador ";", BOM para o UTF-8 e quebra de linha CRLF.

/** Começos que a planilha lê como fórmula (injeção de fórmula em CSV). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Célula entre aspas, com aspas duplicadas; começo de fórmula ganha um apóstrofo na frente. */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}
