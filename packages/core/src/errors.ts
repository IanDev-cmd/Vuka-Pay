export class DomainError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
