import { NextResponse } from "next/server";
import { GitlabError, syncFromGitlab } from "@/lib/gitlab";
import { resetSpecCache } from "@/lib/specs";

// Downloads the bundle.zip of the requested release tag, extracts every
// OpenAPI bundle into public/specs/, and busts the spec cache so the new
// contracts appear without a server restart.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let tag: unknown;
  try {
    ({ tag } = (await req.json()) as { tag?: unknown });
  } catch {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Body must be JSON" },
      { status: 400 },
    );
  }
  if (typeof tag !== "string" || !tag.trim()) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "tag is required" },
      { status: 400 },
    );
  }
  try {
    const result = await syncFromGitlab(tag.trim());
    resetSpecCache();
    return NextResponse.json({ ...result, syncedAt: new Date().toISOString() });
  } catch (err) {
    if (err instanceof GitlabError) {
      return NextResponse.json(
        { error: "gitlab_error", error_description: err.message },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: "gitlab_error", error_description: String(err) },
      { status: 500 },
    );
  }
}
