export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number = 400,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const Errors = {
  notFound: (entity = 'Recurso') =>
    new AppError(`${entity} não encontrado.`, 404, 'NOT_FOUND'),
  unauthorized: () =>
    new AppError('Não autorizado.', 401, 'UNAUTHORIZED'),
  forbidden: () =>
    new AppError('Acesso negado.', 403, 'FORBIDDEN'),
  conflict: (msg: string) =>
    new AppError(msg, 409, 'CONFLICT'),
  validation: (msg: string) =>
    new AppError(msg, 422, 'VALIDATION_ERROR'),
  // Bloqueio ligado em /settings e prazo viria do produto (sem regra ativa de produto nem de categoria).
  ruleRequired: () =>
    new AppError('Produto sem prazo validado para este armazenamento. Chame o gerente para cadastrar a regra.', 422, 'RULE_REQUIRED'),
  // Código curto sorteado repetiu em todas as tentativas. Reenviar com o mesmo requestId é seguro.
  shortCodeUnavailable: () =>
    new AppError('Não foi possível gerar o código da etiqueta. Tente de novo.', 503, 'SHORT_CODE_UNAVAILABLE'),
  internal: () =>
    new AppError('Erro interno do servidor.', 500, 'INTERNAL_ERROR'),
};
