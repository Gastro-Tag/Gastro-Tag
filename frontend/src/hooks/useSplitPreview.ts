import { useEffect, useState } from 'react';
import { labelApi } from '@/services';
import { extractError } from '@/services/api';
import type { SplitPreview, StorageType } from '@/types';

export type SplitPreviewState =
  | { status: 'loading' }
  | { status: 'ok'; data: SplitPreview }
  | { status: 'error'; message: string };

/** Prévia da data da filha. A data e o teto pela origem vêm sempre do servidor. */
export function useSplitPreview(parentId: string | null, storageType: StorageType, temperature: number | null): SplitPreviewState {
  const [state, setState] = useState<SplitPreviewState>({ status: 'loading' });

  useEffect(() => {
    if (!parentId) return;
    let active = true;
    setState({ status: 'loading' });
    labelApi.splitPreview(parentId, { storageType, storageTemperature: temperature ?? undefined })
      .then(({ data }) => { if (active) setState({ status: 'ok', data: data.data }); })
      .catch((error) => { if (active) setState({ status: 'error', message: extractError(error) }); });
    return () => { active = false; };
  }, [parentId, storageType, temperature]);

  return state;
}
