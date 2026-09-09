export class SourceError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function log(event, fields = {}) {
  console.log(
    JSON.stringify({ at: new Date().toISOString(), event, ...fields }),
  );
}
export const health = {
  last_success_at: null,
  last_http_success_at: null,
  last_error: null,
  requests: 0,
  parsing_success: 0,
  parsing_failure: 0,
};
