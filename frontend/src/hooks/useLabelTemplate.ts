import { useCallback, useEffect, useState } from 'react';
import { authApi } from '@/services';
import {
  LABEL_TEMPLATE_EVENT, clearLabelTemplateId, getLabelTemplateChoice, saveLabelTemplateId, setKitchenLabelTemplate,
  type LabelTemplateId,
} from '@/utils/labelTemplates';

const REFRESH_AFTER_MS = 60_000;
let lastFetch = 0;
let inflight: Promise<void> | null = null;

/** Busca o padrão da cozinha no /auth/me. Se falhar, nada muda: vale a exceção do aparelho ou A4. */
function refreshKitchenTemplate(): Promise<void> {
  if (inflight) return inflight;
  if (Date.now() - lastFetch < REFRESH_AFTER_MS) return Promise.resolve();
  inflight = authApi.me()
    .then(({ data }) => {
      const source = data.meta ?? data.data;
      if (source && 'labelTemplate' in source) setKitchenLabelTemplate(source.labelTemplate);
      lastFetch = Date.now();
    })
    .catch(() => { /* sem o padrão, a impressão segue (exceção > A4) */ })
    .finally(() => { inflight = null; });
  return inflight;
}

/**
 * Mantém o padrão da cozinha em memória em toda a área logada (painel e totem), não só nas telas com seletor:
 * a reimpressão direto da lista ou do início do totem também usa o padrão. Rebusca ao voltar à aba (máx. 1/min).
 */
export function useKitchenTemplateSync() {
  useEffect(() => {
    void refreshKitchenTemplate();
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshKitchenTemplate(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
}

/** Modelo de etiqueta que vale, atualizado quando é trocado (nesta aba ou em outra) e quando o padrão da cozinha chega. */
export function useLabelTemplate() {
  const [choice, setChoice] = useState(getLabelTemplateChoice);

  useEffect(() => {
    const refresh = () => setChoice(getLabelTemplateChoice());
    window.addEventListener(LABEL_TEMPLATE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    void refreshKitchenTemplate();
    return () => {
      window.removeEventListener(LABEL_TEMPLATE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const choose = useCallback((id: LabelTemplateId) => saveLabelTemplateId(id), []);
  const useKitchenDefault = useCallback(() => clearLabelTemplateId(), []);
  return { templateId: choice.id, explicit: choice.explicit, source: choice.source, choose, useKitchenDefault };
}
