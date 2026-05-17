import { NextResponse } from "next/server";

export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "deck_not_found"
  | "rate_limit_exceeded"
  | "internal_error";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  deck_not_found: 404,
  rate_limit_exceeded: 429,
  internal_error: 500,
};

export type ApiErrorBody = {
  error: { code: ErrorCode; message: string } & Record<string, unknown>;
};

export function apiError(
  code: ErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): ApiErrorBody {
  return { error: { code, message, ...(extra ?? {}) } };
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(apiError(code, message, extra), {
    status: STATUS_BY_CODE[code],
  });
}
