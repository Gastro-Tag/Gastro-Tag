// `crypto.randomUUID` só existe em contexto seguro; o tablet acessa por http na rede local.
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Validade do id guardado: o objetivo é sobreviver a um reload, não a um turno. */
export const ENTRY_TTL_MS = 10 * 60 * 1000;

interface Entry { signature: string; id: string; createdAt: number }

function sessionStore(): Storage | null {
  try { return sessionStorage; } catch { return null; }
}

function isExpired(createdAt: number, now: number): boolean {
  return now - createdAt > ENTRY_TTL_MS || now < createdAt;
}

/** Lê a entrada guardada, ignorando e apagando a vencida; qualquer falha (storage indisponível, JSON ruim, formato errado) vira null. */
export function loadEntry(key: string, store: Storage | null = sessionStore(), now: number = Date.now()): Entry | null {
  try {
    const raw = store?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Entry> | null;
    if (typeof parsed?.signature !== 'string' || typeof parsed.id !== 'string' || typeof parsed.createdAt !== 'number') return null;
    if (isExpired(parsed.createdAt, now)) { clearEntry(key, store); return null; }
    return { signature: parsed.signature, id: parsed.id, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

export function saveEntry(key: string, entry: Entry, store: Storage | null = sessionStore()): void {
  try { store?.setItem(key, JSON.stringify(entry)); } catch { /* sem storage: só em memória */ }
}

export function clearEntry(key: string, store: Storage | null = sessionStore()): void {
  try { store?.removeItem(key); } catch { /* ignora */ }
}

/**
 * Mantém a mesma chave enquanto o mesmo pedido é reenviado (rede caiu, toque repetido),
 * para o servidor devolver a etiqueta já criada em vez de gravar outra.
 * Pedido diferente ou `reset()` após o sucesso geram chave nova.
 * Com `storageKey`, o par { assinatura, id } também fica em sessionStorage, para sobreviver
 * a um reload da página entre a gravação no servidor e a resposta chegar.
 */
export function createRequestKeeper(storageKey?: string, store?: Storage | null) {
  let current: Entry | null = null;
  const storage = () => (store === undefined ? sessionStore() : store);
  return {
    idFor(payload: unknown): string {
      const signature = JSON.stringify(payload);
      if (!current && storageKey) current = loadEntry(storageKey, storage());
      const now = Date.now();
      if (current && isExpired(current.createdAt, now)) current = null;
      if (current?.signature !== signature) {
        current = { signature, id: uuid(), createdAt: now };
        if (storageKey) saveEntry(storageKey, current, storage());
      }
      return current.id;
    },
    reset() {
      current = null;
      if (storageKey) clearEntry(storageKey, storage());
    },
  };
}
