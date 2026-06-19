import { NextResponse } from "next/server";
import { listApiSummaries } from "@/lib/specs";

// Lightweight list of available APIs (id + title) for client pages that can't
// import the server-only spec loader directly — e.g. the Settings page, which
// needs the API list to render the per-API context-path configuration.

export const dynamic = "force-dynamic";

export async function GET() {
  const apis = await listApiSummaries();
  return NextResponse.json({
    apis: apis.map((a) => ({ id: a.id, title: a.title })),
  });
}
