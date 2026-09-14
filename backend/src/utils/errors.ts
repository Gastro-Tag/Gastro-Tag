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
  internal: () =>
    new AppError('Erro interno do servidor.', 500, 'INTERNAL_ERROR'),
};
