import { NextResponse } from "next/server";
import {
  getGitlabConfigPublic,
  saveGitlabConfig,
} from "@/lib/gitlab";
import type { GitlabConfig } from "@/lib/sync";

// Read/write the GitLab release-source config (host, project, token). The
// token is stored server-side in .packrest.config.json and never returned —
// GET reports only `hasToken`, and PUT keeps the existing token when the
// field is left blank.

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getGitlabConfigPublic());
}

export async function PUT(req: Request) {
  let body: GitlabConfig;
  try {
    body = (await req.json()) as GitlabConfig;
  } catch {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Body must be JSON" },
      { status: 400 },
    );
  }
  const patch: GitlabConfig = {};
  if (typeof body.host === "string") patch.host = body.host;
  if (typeof body.projectPath === "string") patch.projectPath = body.projectPath;
  if (typeof body.token === "string") patch.token = body.token;
  const config = await saveGitlabConfig(patch);
  return NextResponse.json(config);
}
