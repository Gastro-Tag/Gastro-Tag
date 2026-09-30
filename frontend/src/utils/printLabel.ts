import type { Label } from '@/types';
import { formatBR } from './date';

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function safeLogoSource(value: string | null): string {
  if (!value || !/^data:image\/(?:png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(value)) return '';
  return value;
}

export function printLabel(label: Label, logoUrl: string | null): void {
  const root = document.getElementById('print-root');
  if (!root) throw new Error('Área de impressão não encontrada.');

  const name = label.productName ?? label.product?.name ?? '';
  const brand = label.productBrand ?? label.product?.brand ?? '';
  const source = label.rule?.source ?? `Prazo informado no produto (${label.shelfLifeDays ?? '—'} dias)`;
  const logo = safeLogoSource(logoUrl);
  const logoHtml = logo
    ? `<div class="print-logo"><img src="${esc(logo)}" alt="Logo" /></div>`
    : '';

  root.innerHTML = `
    <article class="print-label">
      <header class="print-header">
        <span>Etiqueta de identificação de alimento</span>
        <span class="print-code">Cód: ${esc(label.shortCode)}</span>
      </header>
      <section class="print-content">
        ${logoHtml}
        <h1>${esc(name)}</h1>
        <p class="print-brand">Marca: ${esc(brand)}</p>
        <dl class="print-grid">
          <div><dt>Lote</dt><dd>${esc(label.lot)}</dd></div>
          <div><dt>Data de abertura</dt><dd>${esc(formatBR(label.openedAt))}</dd></div>
          <div><dt>Armazenamento</dt><dd>${label.storageType === 'REFRIGERADO' ? 'Refrigerado' : 'Congelado'}</dd></div>
          <div><dt>Temperatura</dt><dd>${esc(label.storageTemp)}</dd></div>
        </dl>
        <div class="print-discard">
          <span>Descartar em</span>
          <strong>${esc(formatBR(label.discardAt))}</strong>
        </div>
        <p class="print-rule">Prazo aplicado: ${esc(label.shelfLifeDays ?? '—')} dias. Fonte: ${esc(source)}.</p>
        ${label.cappedByOriginalExpiry ? '<p class="print-cap">Data limitada pela validade original do fabricante.</p>' : ''}
        <div class="print-signature">
          <span>Responsável pela manipulação</span>
          <strong>${esc(label.responsibleName || '—')}</strong>
          <div></div>
          <small>Assinatura do responsável</small>
        </div>
      </section>
    </article>`;

  try {
    window.print();
  } finally {
    root.replaceChildren();
  }
}
