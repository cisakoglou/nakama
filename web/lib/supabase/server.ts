import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseConfig } from "./config";
import type { Database } from "./database";

export function createRequestClient(request: NextRequest) {
  const { url, key } = getSupabaseConfig();
  const sessionResponse = new NextResponse();
  const client = createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookies, headers) {
        for (const { name, value, options } of cookies) {
          request.cookies.set(name, value);
          sessionResponse.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(headers)) {
          sessionResponse.headers.set(name, value);
        }
      },
    },
  });

  function applySession(response: NextResponse) {
    for (const cookie of sessionResponse.cookies.getAll()) {
      response.cookies.set(cookie);
    }
    for (const [name, value] of sessionResponse.headers) {
      if (name !== "set-cookie") response.headers.set(name, value);
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  return {
    client,
    json: (body: unknown, status = 200) =>
      applySession(NextResponse.json(body, { status })),
    redirect: (url: URL) => applySession(NextResponse.redirect(url)),
    respond: (response: Response) => applySession(new NextResponse(response.body, {
      status: response.status, headers: response.headers,
    })),
  };
}
