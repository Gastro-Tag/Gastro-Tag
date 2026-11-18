import { useCallback, useEffect, useState } from 'react';
import {
  LABEL_TEMPLATE_EVENT, getLabelTemplateChoice, saveLabelTemplateId, type LabelTemplateId,
} from '@/utils/labelTemplates';

/** Modelo de etiqueta deste aparelho, atualizado quando é trocado (nesta aba ou em outra). */
export function useLabelTemplate() {
  const [choice, setChoice] = useState(getLabelTemplateChoice);

  useEffect(() => {
    const refresh = () => setChoice(getLabelTemplateChoice());
    window.addEventListener(LABEL_TEMPLATE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(LABEL_TEMPLATE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const choose = useCallback((id: LabelTemplateId) => saveLabelTemplateId(id), []);
  return { templateId: choice.id, explicit: choice.explicit, choose };
}
