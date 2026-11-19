// Modelos de etiqueta. Padrão da cozinha, com exceção por aparelho (a impressora fica ligada ao aparelho).
export type LabelTemplateId = 'a4' | 't100x60' | 't60x40' | 't50x30';

/** full: todas as informações; short: resumida; minimal: só o essencial. */
export type LabelVariant = 'full' | 'short' | 'minimal';

export interface LabelTemplate {
  id: LabelTemplateId;
  name: string;
  description: string;
  /** Tamanho em mm; null no papel comum, onde a etiqueta tem 9 cm de largura e altura livre. */
  widthMm: number | null;
  heightMm: number | null;
  compact: boolean;
  variant: LabelVariant;
}

export const LABEL_TEMPLATE_KEY = 'gastrotag_label_template';
export const DEFAULT_LABEL_TEMPLATE: LabelTemplateId = 'a4';

export const LABEL_TEMPLATES: LabelTemplate[] = [
  { id: 'a4', name: 'Folha A4 / comum (9 cm)', description: 'Todas as informações, com logo, em papel comum (9 cm de largura).', widthMm: null, heightMm: null, compact: false, variant: 'full' },
  { id: 't100x60', name: 'Térmica 100 × 60 mm', description: 'Todas as informações, com logo. A letra diminui sozinha se o texto for longo.', widthMm: 100, heightMm: 60, compact: true, variant: 'full' },
  { id: 't60x40', name: 'Térmica 60 × 40 mm (resumida)', description: 'Resumida: sem logo, marca e assinatura. Mostra produto, descarte (maior), abertura, lote, armazenamento, validade do fabricante, prazo e tipo da fonte (ou SEM REGRA VALIDADA), responsável e código.', widthMm: 60, heightMm: 40, compact: true, variant: 'short' },
  { id: 't50x30', name: 'Térmica 50 × 30 mm (mínima)', description: 'Mínima: sem logo, marca, prazo/fonte e assinatura. Mostra produto, descarte (maior), abertura, lote, validade do fabricante, responsável e código, com S/ REGRA quando não há regra; armazenamento só se couber.', widthMm: 50, heightMm: 30, compact: true, variant: 'minimal' },
];

export function isLabelTemplateId(value: unknown): value is LabelTemplateId {
  return LABEL_TEMPLATES.some((template) => template.id === value);
}

export function getLabelTemplate(id: string | null | undefined): LabelTemplate {
  return LABEL_TEMPLATES.find((template) => template.id === id) ?? LABEL_TEMPLATES[0];
}

// Escolha que não conseguiu ser gravada (localStorage indisponível): vale nesta aba, para a tela e a
// impressão concordarem. Gravada com sucesso, quem manda é o localStorage, e outra aba vê a troca.
let unsavedTemplateId: LabelTemplateId | null = null;

// Padrão da cozinha (GET /auth/me). Fica em memória para a impressão (fora do React) usar o mesmo modelo da tela.
let kitchenTemplateId: LabelTemplateId | null = null;

/** De onde vem o modelo que vale: exceção do aparelho, padrão da cozinha ou nenhum (A4 com aviso). */
export type LabelTemplateSource = 'device' | 'kitchen' | 'none';

export interface LabelTemplateChoice {
  id: LabelTemplateId;
  /** false quando ninguém definiu: a impressão cai em A4. */
  explicit: boolean;
  source: LabelTemplateSource;
}

/** Prioridade: exceção do aparelho > padrão da cozinha > A4 (não escolhido). Valores inválidos são ignorados. */
export function resolveLabelTemplate(device: unknown, kitchen: unknown): LabelTemplateChoice {
  if (isLabelTemplateId(device)) return { id: device, explicit: true, source: 'device' };
  if (isLabelTemplateId(kitchen)) return { id: kitchen, explicit: true, source: 'kitchen' };
  return { id: DEFAULT_LABEL_TEMPLATE, explicit: false, source: 'none' };
}

export const LABEL_TEMPLATE_SOURCE_TEXT: Record<LabelTemplateSource, string> = {
  kitchen: 'Padrão da cozinha',
  device: 'Exceção deste aparelho',
  none: 'Não escolhido: A4',
};

/** Escolha própria deste aparelho (a exceção), ou null. */
function readDeviceTemplate(): LabelTemplateId | null {
  if (unsavedTemplateId) return unsavedTemplateId;
  try {
    const value = localStorage.getItem(LABEL_TEMPLATE_KEY);
    return isLabelTemplateId(value) ? value : null;
  } catch {
    return null;
  }
}

/** Modelo em uso: exceção do aparelho, senão padrão da cozinha, senão A4 sem escolha (nunca trava a impressão). */
export function getLabelTemplateChoice(): LabelTemplateChoice {
  return resolveLabelTemplate(readDeviceTemplate(), kitchenTemplateId);
}

/** Guarda o padrão da cozinha vindo do servidor (valor desconhecido vira nulo) e avisa as telas abertas. */
export function setKitchenLabelTemplate(value: unknown): void {
  const next = isLabelTemplateId(value) ? value : null;
  if (next === kitchenTemplateId) return;
  kitchenTemplateId = next;
  window.dispatchEvent(new Event(LABEL_TEMPLATE_EVENT));
}

/** Remove a exceção deste aparelho: passa a valer o padrão da cozinha. */
export function clearLabelTemplateId(): void {
  unsavedTemplateId = null;
  try { localStorage.removeItem(LABEL_TEMPLATE_KEY); } catch { /* sem armazenamento: nada a apagar */ }
  window.dispatchEvent(new Event(LABEL_TEMPLATE_EVENT));
}

export function loadLabelTemplateId(): LabelTemplateId {
  return getLabelTemplateChoice().id;
}

/** Avisa as telas abertas (mesma aba) de que o modelo mudou; outras abas recebem o evento `storage`. */
export const LABEL_TEMPLATE_EVENT = 'gastrotag:label-template';

export const LABEL_TEMPLATE_NOT_CHOSEN_TEXT = 'Modelo de etiqueta não escolhido (nem na cozinha nem neste aparelho): imprimindo em A4.';

export function saveLabelTemplateId(id: LabelTemplateId): void {
  try {
    localStorage.setItem(LABEL_TEMPLATE_KEY, id);
    unsavedTemplateId = null;
  } catch {
    unsavedTemplateId = id; // sem armazenamento: a escolha vale até recarregar a página
  }
  window.dispatchEvent(new Event(LABEL_TEMPLATE_EVENT));
}
