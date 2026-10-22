export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to perform this action', code = 'FORBIDDEN') =>
  new AppError(403, code, message);
// 404 is also used for resources in other tenants so their existence is not revealed.
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);
export const limitReached = (message: string, details?: unknown) => new AppError(402, 'PLAN_LIMIT_REACHED', message, details);
export const featureUnavailable = (feature: string) =>
  new AppError(402, 'FEATURE_NOT_IN_PLAN', `Your current plan does not include ${feature}`, { feature });
