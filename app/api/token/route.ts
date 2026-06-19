import { NextResponse } from "next/server";
import { checkUrl } from "@/lib/url-policy";

// Server-side proxy for OAuth2 Client Credentials. The browser never holds
// the client_secret long enough to be sniffed by an extension — secrets
// live in localStorage and travel through this route inside a single POST
// to the configured tokenUrl, which is what really hits the IAM.
//
// Request body: { tokenUrl, clientId, clientSecret, scopes: string[] }
// Response:     200 { access_token, token_type, expires_in, scope }
//               4xx { error, error_description }
//
// Security: `tokenUrl` must point to an allowlisted host so the route
// can't be used as an SSRF pivot toward internal services.

export const dynamic = "force-dynamic";

interface TokenRequest {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
}

export async function POST(req: Request) {
  let body: TokenRequest;
  try {
    body = (await req.json()) as TokenRequest;
  } catch {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Body must be JSON" },
      { status: 400 },
    );
  }
  const { tokenUrl, clientId, clientSecret, scopes = [] } = body;
  if (!tokenUrl || !clientId || !clientSecret) {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: "tokenUrl, clientId and clientSecret are required",
      },
      { status: 400 },
    );
  }
  const urlCheck = checkUrl(tokenUrl);
  if (!urlCheck.ok) {
    return NextResponse.json(
      { error: "forbidden_url", error_description: urlCheck.reason },
      { status: 400 },
    );
  }

  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  if (scopes.length) form.set("scope", scopes.join(" "));

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const upstream = await fetch(urlCheck.url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await upstream.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { error: "upstream_invalid_json", raw: text };
  }
  return NextResponse.json(parsed, { status: upstream.status });
}
