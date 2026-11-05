import type { NextRequest } from "next/server";

export function getAppOrigin(request: NextRequest) {
  return process.env.APP_ORIGIN
    ? new URL(process.env.APP_ORIGIN).origin
    : request.nextUrl.origin;
}
