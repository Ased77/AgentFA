export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: unknown;

  constructor(status: number, code: string, detail?: unknown) {
    super(code);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const badRequest = (code: string, detail?: unknown) =>
  new HttpError(400, code, detail);
export const unauthorized = (code = "unauthorized") => new HttpError(401, code);
export const forbidden = (code = "forbidden", detail?: unknown) =>
  new HttpError(403, code, detail);
export const notFound = (code = "not_found") => new HttpError(404, code);
export const conflict = (code: string) => new HttpError(409, code);
export const tooMany = (code = "rate_limited") => new HttpError(429, code);
export const paymentRequired = (code = "balance", detail?: unknown) =>
  new HttpError(402, code, detail);

export function errorPayload(err: unknown) {
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: err.code, detail: err.detail ?? null } };
  }
  return { status: 500, body: { error: "internal" } };
}