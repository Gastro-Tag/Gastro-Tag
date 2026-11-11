// `crypto.randomUUID` só existe em contexto seguro; o tablet acessa por http na rede local.
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Mantém a mesma chave enquanto o mesmo pedido é reenviado (rede caiu, toque repetido),
 * para o servidor devolver a etiqueta já criada em vez de gravar outra.
 * Pedido diferente ou `reset()` após o sucesso geram chave nova.
 */
export function createRequestKeeper() {
  let current: { signature: string; id: string } | null = null;
  return {
    idFor(payload: unknown): string {
      const signature = JSON.stringify(payload);
      if (current?.signature !== signature) current = { signature, id: uuid() };
      return current.id;
    },
    reset() { current = null; },
  };
}
