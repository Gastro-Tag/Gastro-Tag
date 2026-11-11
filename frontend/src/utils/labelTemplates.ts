// Modelos de etiqueta. A escolha é por aparelho (a impressora fica ligada ao aparelho).
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
  { id: 't60x40', name: 'Térmica 60 × 40 mm (resumida)', description: 'Resumida: sem logo, marca, prazo/fonte, aviso do fabricante e assinatura. Mostra produto, descarte, abertura, lote, armazenamento, responsável e código.', widthMm: 60, heightMm: 40, compact: true, variant: 'short' },
  { id: 't50x30', name: 'Térmica 50 × 30 mm (mínima)', description: 'Mínima: sem logo, marca, prazo/fonte, aviso do fabricante e assinatura. Mostra produto, descarte, abertura, lote, responsável e código; armazenamento só se couber.', widthMm: 50, heightMm: 30, compact: true, variant: 'minimal' },
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

export function loadLabelTemplateId(): LabelTemplateId {
  if (unsavedTemplateId) return unsavedTemplateId;
  try {
    const value = localStorage.getItem(LABEL_TEMPLATE_KEY);
    return isLabelTemplateId(value) ? value : DEFAULT_LABEL_TEMPLATE;
  } catch {
    return DEFAULT_LABEL_TEMPLATE;
  }
}

export function saveLabelTemplateId(id: LabelTemplateId): void {
  try {
    localStorage.setItem(LABEL_TEMPLATE_KEY, id);
    unsavedTemplateId = null;
  } catch {
    unsavedTemplateId = id; // sem armazenamento: a escolha vale até recarregar a página
  }
}
