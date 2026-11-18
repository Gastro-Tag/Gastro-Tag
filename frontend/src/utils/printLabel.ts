import type { Label, RuleSourceType } from '@/types';
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
/** Classe do body enquanto há etiqueta na área de impressão; o CSS só esconde o app com ela. */
export const PRINTING_CLASS = 'printing-label';
const SAFETY_CLEANUP_MS = 120_000;

let pendingCleanup: (() => void) | null = null;

function clearPrintArea(): void {
  pendingCleanup?.();
  pendingCleanup = null;
  document.getElementById('print-root')?.replaceChildren();
  document.getElementById(PAGE_STYLE_ID)?.remove();
  document.body.classList.remove(PRINTING_CLASS);
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

const NO_RULE_TEXT = 'Prazo sem regra validada';
// Modelos pequenos: textos curtos (o tipo da fonte, nunca o texto livre).
const NO_RULE_SHORT_TEXT = 'SEM REGRA VALIDADA';
const NO_RULE_MINIMAL_TEXT = 'S/ REGRA';
const SOURCE_TYPE_SHORT: Record<RuleSourceType, string> = {
  NORMA_LEGAL: 'Norma',
  REFERENCIA_TECNICA: 'Ref. técnica',
  FABRICANTE: 'Fabricante',
  PROCEDIMENTO_INTERNO: 'Proc. interno',
};

/** Validade do fabricante (DD/MM/AAAA); vazia quando a etiqueta não tem. */
function manufacturerExpiry(label: Label): string {
  return label.originalExpiryDate ? esc(formatBR(label.originalExpiryDate)) : '';
}

/** "3 dias · Fabricante" no 60×40; "SEM REGRA VALIDADA" (60×40) ou "S/ REGRA" (50×30) sem regra. */
function ruleShort(label: Label, minimal: boolean): string {
  if (!label.ruleId) return `<span class="pt-cap">${minimal ? NO_RULE_MINIMAL_TEXT : NO_RULE_SHORT_TEXT}</span>`;
  if (minimal) return '';
  const type = label.rule?.sourceType;
  const source = type ? SOURCE_TYPE_SHORT[type] : undefined;
  const days = label.shelfLifeDays != null ? `${esc(label.shelfLifeDays)} dias` : '';
  return `<span class="pt-ruleshort">${[days, source && esc(source)].filter(Boolean).join(' · ')}</span>`;
}
const PARENT_CAP_TEXT = 'Data limitada pela etiqueta de origem.';

/** Linha de origem das etiquetas filhas; vazia nas demais. `short` é para o 60×40. */
function fractionLine(label: Label, short: boolean): string {
  const code = label.parent?.shortCode;
  if (!code) return '';
  if (short) return `Frac. de ${esc(code)}`;
  const day = label.fractionedAt ? ` em ${esc(formatBR(label.fractionedAt).slice(0, 5))}` : '';
  return `Fracionado de ${esc(code)}${day}`;
}

function storageLabel(label: Label): string {
  return label.storageType === 'REFRIGERADO' ? 'Refrigerado' : 'Congelado';
}

export function fullLabel(label: Label, logo: string): string {
  const name = label.productName ?? label.product?.name ?? '';
  const brand = label.productBrand ?? label.product?.brand ?? '';
  const source = (label.ruleId && (label.ruleSource ?? label.rule?.source)) || `Prazo informado no produto (${label.shelfLifeDays ?? '—'} dias)`;
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
          ${manufacturerExpiry(label) ? `<div><dt>Val. fabricante</dt><dd>${manufacturerExpiry(label)}</dd></div>` : ''}
        </dl>
        <div class="print-discard">
          <span>Descartar em</span>
          <strong>${esc(formatBR(label.discardAt))}</strong>
        </div>
        <p class="print-rule">Prazo aplicado: ${esc(label.shelfLifeDays ?? '—')} dias. Fonte: ${esc(source)}.</p>
        ${label.parent ? `<p class="print-cap">${fractionLine(label, false)}</p>` : ''}
        ${label.cappedByParent ? `<p class="print-cap">${PARENT_CAP_TEXT}</p>` : ''}
        ${label.ruleId ? '' : `<p class="print-cap">${NO_RULE_TEXT}</p>`}
        ${label.cappedByOriginalExpiry ? '<p class="print-cap">Data limitada pela validade original do fabricante.</p>' : ''}
        <div class="print-signature">
          <span>Responsável pela manipulação: <strong>${esc(label.responsibleName || '—')}</strong></span>
          <div></div>
          <small>Assinatura do Manipulador</small>
        </div>
      </section>
    </article>`;
}

// A data de descarte não entra nesta escala nos modelos 60×40 e 50×30 (tamanho fixo no CSS).
// Escala mínima de fonte do ajuste automático; abaixo disso a etiqueta cresce (ver pt-grow).
const SCALE_STEP = 0.05;
const SCALE_MIN = 0.5;

// Piso da data de descarte nos modelos pequenos (fração do tamanho normal, 22→18 pt e 16→14 pt):
// só é usado quando, sem ele, a etiqueta cresceria ou perderia o armazenamento.
const DATE_FLOOR: Partial<Record<LabelTemplate['variant'], number>> = { short: 18 / 22, minimal: 14 / 16 };

const LONG_LOT_CHARS = 12;

interface CompactOptions { scale?: number; grow?: boolean; storage?: boolean; dateScale?: number }

export function compactLabel(label: Label, template: LabelTemplate, logo: string, options: CompactOptions = {}): string {
  const { scale = 1, grow = false, storage = true, dateScale = 1 } = options;
  const name = label.productName ?? label.product?.name ?? '';
  const brand = label.productBrand ?? label.product?.brand ?? '';
  const source = (label.ruleId && (label.ruleSource ?? label.rule?.source)) || `Prazo informado no produto (${label.shelfLifeDays ?? '—'} dias)`;
  const full = template.variant === 'full';
  const minimal = template.variant === 'minimal';
  const nameSize = nameFontPt(name, full ? [14, 12, 10] : minimal ? [9, 8, 7] : [11, 9, 7.5]);
  const expiry = manufacturerExpiry(label);
  const logoHtml = `<img class="pt-logo" src="${esc(logo)}" alt="GastroTag" />`;
  const noRule = label.ruleId ? '' : `<p class="pt-cap">${NO_RULE_TEXT}</p>`;
  const cap = label.cappedByOriginalExpiry
    ? '<p class="pt-cap">Data limitada pela validade original do fabricante.</p>' : '';
  // 50×30 não tem espaço: sem mudança.
  const parentCap = full && label.cappedByParent ? `<p class="pt-cap">${PARENT_CAP_TEXT}</p>` : '';
  const fraction = parentCap + (!minimal && label.parent ? `<p class="pt-cap">${fractionLine(label, !full)}</p>` : '');
  const open = `class="print-label print-thermal print-${template.id}${grow ? ' pt-grow' : ''}" style="--pt-scale:${scale};--pt-ds:${dateScale}"`;
  const title = `<h1 style="font-size:max(6pt, calc(${nameSize}pt * var(--pt-scale, 1)))">${esc(name)}</h1>`;
  const discard = `<div class="pt-discard"><span>Descartar em</span><strong>${esc(formatBR(label.discardAt))}</strong></div>`;
  if (!full) {
    const temp = esc(label.storageTemp);
    // 50×30: armazenamento e validade do fabricante dividem uma linha de duas colunas.
    const storageItem = minimal
      ? (storage ? `<div><dd>${label.storageType === 'REFRIGERADO' ? 'Refrig.' : 'Congel.'} ${temp}</dd></div>` : '')
      : `<div class="pt-wide"><dt>Armazenamento</dt><dd>${storageLabel(label)}, ${temp}</dd></div>`;
    // 60×40 com lote longo: o lote ocupa a linha toda e a validade do fabricante divide a linha da abertura.
    const longLot = !minimal && label.lot.length > LONG_LOT_CHARS;
    const expiryItem = expiry ? `<div${minimal || longLot ? '' : ' class="pt-wide"'}><dt>${minimal ? 'Val.' : 'Val. fab.'}</dt><dd>${expiry}</dd></div>` : '';
    return `
    <article ${open}>
      ${title}
      ${discard}
      <dl class="pt-grid">
        <div${longLot ? ' class="pt-wide"' : ''}><dt>Lote</dt><dd>${esc(label.lot)}</dd></div>
        <div><dt>${minimal ? 'Abert.' : 'Abertura'}</dt><dd>${esc(formatBR(label.openedAt))}</dd></div>
        ${longLot ? expiryItem + storageItem : storageItem + expiryItem}
      </dl>
      ${fraction}
      <p class="pt-resp">${minimal ? 'Resp.' : 'Responsável'}: <strong>${esc(label.responsibleName || '—')}</strong></p>
      <div class="pt-foot">${ruleShort(label, minimal)}<span class="pt-code">Cód: ${esc(label.shortCode)}</span></div>
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
        ${expiry ? `<div><dt>Val. fab.</dt><dd>${expiry}</dd></div>` : ''}
      </dl>
      <p class="pt-rule">Prazo aplicado: ${esc(label.shelfLifeDays ?? '—')} dias. Fonte: ${esc(source)}.</p>
      ${fraction}
      ${noRule}
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
  const tryFit = (storage: boolean, dateScale: number): number | null => {
    const maxHeight = limit.getBoundingClientRect().height;
    for (let scale = 1; scale >= SCALE_MIN - 1e-9; scale = Math.round((scale - SCALE_STEP) * 100) / 100) {
      stage.innerHTML = compactLabel(label, template, logo, { scale, storage, dateScale });
      const article = stage.firstElementChild as HTMLElement;
      article.style.height = 'auto';
      if (article.getBoundingClientRect().height <= maxHeight + 0.5 && article.scrollWidth <= article.clientWidth + 1) return scale;
    }
    return null;
  };
  try {
    // Ordem de cessão nos modelos pequenos: primeiro os outros textos encolhem; depois a data cai ao piso;
    // só então (50×30) some o armazenamento.
    const floor = DATE_FLOOR[template.variant];
    const dateSteps = floor ? [1, floor] : [1];
    for (const storage of template.variant === 'minimal' ? [true, false] : [true]) {
      for (const dateScale of dateSteps) {
        const scale = tryFit(storage, dateScale);
        if (scale !== null) return { options: { scale, storage, dateScale } };
      }
    }
    return { options: { scale: SCALE_MIN, grow: true, storage: template.variant !== 'minimal', dateScale: floor ?? 1 } };
  } finally {
    probe.remove();
  }
}

/** Uma etiqueta (com cópias) ou várias (ex.: filhas de um fracionamento) em uma única impressão. */
export function printLabel(labelOrLabels: Label | Label[], logoUrl: string | null, copies = 1): void {
  const labels = Array.isArray(labelOrLabels) ? labelOrLabels : [labelOrLabels];
  const label = labels[0];
  if (!label) return;
  const root = document.getElementById('print-root');
  if (!root) throw new Error('Área de impressão não encontrada.');

  // Limpa qualquer etiqueta anterior que ainda estivesse na área de impressão.
  clearPrintArea();

  const template = getLabelTemplate(loadLabelTemplateId());
  const logo = safeLogoSource(logoUrl);
  const fit = template.compact && template.widthMm && template.heightMm ? fitCompact(label, template, logo) : null;
  const render = (item: Label) => (template.compact
    ? compactLabel(item, template, logo, fit?.options)
    : fullLabel(item, logo));
  const count = Math.min(Math.max(Math.trunc(copies) || 1, 1), 20);
  root.innerHTML = labels.flatMap((item) => Array.from({ length: count }, () => render(item))).join('');
  injectPageStyle(template);
  document.body.classList.add(PRINTING_CLASS);

  // Em alguns navegadores (Chrome Android, modo quiosque) print() não bloqueia:
  // a área só pode ser limpa quando a impressão termina (afterprint), com um tempo de segurança como reserva.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    window.removeEventListener('afterprint', onAfterPrint);
    if (timer) clearTimeout(timer);
    if (pendingCleanup === cleanup) pendingCleanup = null;
    root.replaceChildren();
    document.getElementById(PAGE_STYLE_ID)?.remove();
    document.body.classList.remove(PRINTING_CLASS);
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
