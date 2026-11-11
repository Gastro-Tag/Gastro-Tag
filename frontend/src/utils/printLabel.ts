import type { Label } from '@/types';
import { formatBR } from './date';
import { getLabelTemplate, loadLabelTemplateId, type LabelTemplate } from './labelTemplates';

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function safeLogoSource(value: string | null): string {
  if (!value) return '/logo.png';
  if (value === '/logo.png') return '/logo.png';
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(value)) return value;
  return '/logo.png';
}

const PAGE_STYLE_ID = 'print-page-style';
const SAFETY_CLEANUP_MS = 120_000;

let pendingCleanup: (() => void) | null = null;

function clearPrintArea(): void {
  pendingCleanup?.();
  pendingCleanup = null;
  document.getElementById('print-root')?.replaceChildren();
  document.getElementById(PAGE_STYLE_ID)?.remove();
}

function injectPageStyle(template: LabelTemplate): void {
  const style = document.createElement('style');
  style.id = PAGE_STYLE_ID;
  style.textContent = template.widthMm && template.heightMm
    ? `@page { size: ${template.widthMm}mm ${template.heightMm}mm; margin: 0; }`
    : '@page { size: auto; margin: 12mm; }';
  document.head.appendChild(style);
}

// Reduz a fonte do nome conforme o tamanho do texto, para nomes longos caberem sem corte.
function nameFontPt(name: string, steps: [number, number, number]): number {
  if (name.length <= 24) return steps[0];
  if (name.length <= 44) return steps[1];
  return steps[2];
}

function storageLabel(label: Label): string {
  return label.storageType === 'REFRIGERADO' ? 'Refrigerado' : 'Congelado';
}

function fullLabel(label: Label, logo: string): string {
  const name = label.productName ?? label.product?.name ?? '';
  const brand = label.productBrand ?? label.product?.brand ?? '';
  const source = label.rule?.source ?? `Prazo informado no produto (${label.shelfLifeDays ?? '—'} dias)`;
  return `
    <article class="print-label">
      <header class="print-header">
        <span>Etiqueta de Identificação</span>
        <span class="print-code">Cód: ${esc(label.shortCode)}</span>
      </header>
      <section class="print-content">
        <div class="print-logo"><img src="${esc(logo)}" alt="GastroTag" /></div>
        <h1>${esc(name)}</h1>
        <p class="print-brand">Marca: ${esc(brand)}</p>
        <dl class="print-grid">
          <div><dt>Lote</dt><dd>${esc(label.lot)}</dd></div>
          <div><dt>Data de abertura</dt><dd>${esc(formatBR(label.openedAt))}</dd></div>
          <div><dt>Armazenamento</dt><dd>${storageLabel(label)}</dd></div>
          <div><dt>Temperatura</dt><dd>${esc(label.storageTemp)}</dd></div>
        </dl>
        <div class="print-discard">
          <span>Descartar em</span>
          <strong>${esc(formatBR(label.discardAt))}</strong>
        </div>
        <p class="print-rule">Prazo aplicado: ${esc(label.shelfLifeDays ?? '—')} dias. Fonte: ${esc(source)}.</p>
        ${label.cappedByOriginalExpiry ? '<p class="print-cap">Data limitada pela validade original do fabricante.</p>' : ''}
        <div class="print-signature">
          <span>Responsável pela manipulação: <strong>${esc(label.responsibleName || '—')}</strong></span>
          <div></div>
          <small>Assinatura do Manipulador</small>
        </div>
      </section>
    </article>`;
}

// Escala mínima de fonte do ajuste automático; abaixo disso a etiqueta cresce (ver pt-grow).
const SCALE_STEP = 0.05;
const SCALE_MIN = 0.5;

interface CompactOptions { scale?: number; grow?: boolean; storage?: boolean }

function compactLabel(label: Label, template: LabelTemplate, logo: string, options: CompactOptions = {}): string {
  const { scale = 1, grow = false, storage = true } = options;
  const name = label.productName ?? label.product?.name ?? '';
  const brand = label.productBrand ?? label.product?.brand ?? '';
  const source = label.rule?.source ?? `Prazo informado no produto (${label.shelfLifeDays ?? '—'} dias)`;
  const full = template.variant === 'full';
  const minimal = template.variant === 'minimal';
  const nameSize = nameFontPt(name, full ? [14, 12, 10] : minimal ? [9, 8, 7] : [11, 9, 7.5]);
  const logoHtml = `<img class="pt-logo" src="${esc(logo)}" alt="GastroTag" />`;
  const cap = label.cappedByOriginalExpiry
    ? '<p class="pt-cap">Data limitada pela validade original do fabricante.</p>' : '';
  const open = `class="print-label print-thermal print-${template.id}${grow ? ' pt-grow' : ''}" style="--pt-scale:${scale}"`;
  const title = `<h1 style="font-size:max(6pt, calc(${nameSize}pt * var(--pt-scale, 1)))">${esc(name)}</h1>`;
  const discard = `<div class="pt-discard"><span>Descartar em</span><strong>${esc(formatBR(label.discardAt))}</strong></div>`;
  if (!full) {
    const temp = esc(label.storageTemp);
    const storageItem = minimal
      ? (storage ? `<div class="pt-wide"><dt>Armaz.</dt><dd>${label.storageType === 'REFRIGERADO' ? 'Refrig.' : 'Congel.'} ${temp}</dd></div>` : '')
      : `<div class="pt-wide"><dt>Armazenamento</dt><dd>${storageLabel(label)}, ${temp}</dd></div>`;
    return `
    <article ${open}>
      ${title}
      ${discard}
      <dl class="pt-grid">
        <div><dt>Lote</dt><dd>${esc(label.lot)}</dd></div>
        <div><dt>Abertura</dt><dd>${esc(formatBR(label.openedAt))}</dd></div>
        ${storageItem}
      </dl>
      <p class="pt-resp">${minimal ? 'Resp.' : 'Responsável'}: <strong>${esc(label.responsibleName || '—')}</strong></p>
      <div class="pt-foot"><span class="pt-code">Cód: ${esc(label.shortCode)}</span></div>
    </article>`;
  }
  return `
    <article ${open}>
      <div class="pt-top">
        ${logoHtml}
        <div class="pt-id">
          ${title}
          <p class="pt-brand">Marca: ${esc(brand)}</p>
        </div>
      </div>
      ${discard}
      <dl class="pt-grid">
        <div><dt>Lote</dt><dd>${esc(label.lot)}</dd></div>
        <div><dt>Abertura</dt><dd>${esc(formatBR(label.openedAt))}</dd></div>
        <div><dt>Armazenamento</dt><dd>${storageLabel(label)}</dd></div>
        <div><dt>Temperatura</dt><dd>${esc(label.storageTemp)}</dd></div>
      </dl>
      <p class="pt-rule">Prazo aplicado: ${esc(label.shelfLifeDays ?? '—')} dias. Fonte: ${esc(source)}.</p>
      ${cap}
      <p class="pt-resp">Responsável pela manipulação: <strong>${esc(label.responsibleName || '—')}</strong></p>
      <div class="pt-foot">
        <div class="pt-sign"><small>Assinatura do Manipulador</small></div>
        <span class="pt-code">Cód: ${esc(label.shortCode)}</span>
      </div>
    </article>`;
}

interface CompactFit { options: CompactOptions }

// Mede a etiqueta térmica fora da tela e reduz a escala da fonte até caber na altura.
// Na mínima, armazenamento/temperatura só ficam se couberem. Se nem na escala mínima
// couber, deixa a altura crescer (o resto sai na etiqueta seguinte), sem cortar nada.
function fitCompact(label: Label, template: LabelTemplate, logo: string): CompactFit {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;';
  const limit = document.createElement('div');
  limit.style.cssText = `height:${(template.heightMm ?? 0) - 0.5}mm;width:1px;`;
  const stage = document.createElement('div');
  probe.append(limit, stage);
  document.body.appendChild(probe);
  const tryFit = (storage: boolean): number | null => {
    const maxHeight = limit.getBoundingClientRect().height;
    for (let scale = 1; scale >= SCALE_MIN - 1e-9; scale = Math.round((scale - SCALE_STEP) * 100) / 100) {
      stage.innerHTML = compactLabel(label, template, logo, { scale, storage });
      const article = stage.firstElementChild as HTMLElement;
      article.style.height = 'auto';
      if (article.getBoundingClientRect().height <= maxHeight + 0.5 && article.scrollWidth <= article.clientWidth + 1) return scale;
    }
    return null;
  };
  try {
    const withStorage = tryFit(true);
    if (withStorage !== null) return { options: { scale: withStorage, storage: true } };
    if (template.variant === 'minimal') {
      const without = tryFit(false);
      if (without !== null) return { options: { scale: without, storage: false } };
    }
    return { options: { scale: SCALE_MIN, grow: true, storage: template.variant !== 'minimal' } };
  } finally {
    probe.remove();
  }
}

export function printLabel(label: Label, logoUrl: string | null, copies = 1): void {
  const root = document.getElementById('print-root');
  if (!root) throw new Error('Área de impressão não encontrada.');

  // Limpa qualquer etiqueta anterior que ainda estivesse na área de impressão.
  clearPrintArea();

  const template = getLabelTemplate(loadLabelTemplateId());
  const logo = safeLogoSource(logoUrl);
  const fit = template.compact && template.widthMm && template.heightMm ? fitCompact(label, template, logo) : null;
  const article = template.compact
    ? compactLabel(label, template, logo, fit?.options)
    : fullLabel(label, logo);
  const count = Math.min(Math.max(Math.trunc(copies) || 1, 1), 20);
  root.innerHTML = Array.from({ length: count }, () => article).join('');
  injectPageStyle(template);

  // Em alguns navegadores (Chrome Android, modo quiosque) print() não bloqueia:
  // a área só pode ser limpa quando a impressão termina (afterprint), com um tempo de segurança como reserva.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    window.removeEventListener('afterprint', onAfterPrint);
    if (timer) clearTimeout(timer);
    if (pendingCleanup === cleanup) pendingCleanup = null;
    root.replaceChildren();
    document.getElementById(PAGE_STYLE_ID)?.remove();
  };
  function onAfterPrint() { cleanup(); }
  window.addEventListener('afterprint', onAfterPrint);
  timer = setTimeout(cleanup, SAFETY_CLEANUP_MS);
  pendingCleanup = cleanup;

  try {
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}
