import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CONFIG_FILE,
  isForbiddenSpecsDir,
  loadConfig,
  saveConfig,
  resolveSpecsDir,
  type PackrestConfig,
} from "@/lib/sync";

// Read/write packrest config (currently just specsDir). The config lives
// at .packrest.config.json at the repo root and is consumed by both the
// /api/sync-specs route and scripts/copy-specs.mjs.

export const dynamic = "force-dynamic";

export async function GET() {
  const { config, error } = await loadConfig();
  const resolvedSpecsDir = await resolveSpecsDir();
  return NextResponse.json({
    config,
    resolvedSpecsDir,
    configFile: CONFIG_FILE,
    configError: error,
  });
}

export async function PUT(req: Request) {
  let body: PackrestConfig;
  try {
    body = (await req.json()) as PackrestConfig;
  } catch {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Body must be JSON" },
      { status: 400 },
    );
  }
  const specsDir =
    typeof body.specsDir === "string" ? body.specsDir.trim() : "";
  if (!specsDir) {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: "specsDir is required",
      },
      { status: 400 },
    );
  }
  const resolved = path.resolve(specsDir);
  const forbidden = isForbiddenSpecsDir(resolved);
  if (forbidden) {
    return NextResponse.json(
      { error: "forbidden_path", error_description: forbidden },
      { status: 400 },
    );
  }
  // Symlink hardening: also check the real path after symlink resolution,
  // so a "safe" name pointing at /etc still gets refused.
  let realResolved: string;
  try {
    realResolved = await fs.realpath(resolved);
  } catch {
    return NextResponse.json(
      {
        error: "invalid_path",
        error_description: `Path not accessible: ${resolved}`,
      },
      { status: 400 },
    );
  }
  const realForbidden = isForbiddenSpecsDir(realResolved);
  if (realForbidden) {
    return NextResponse.json(
      {
        error: "forbidden_path",
        error_description: `${realForbidden} (résolu : ${realResolved})`,
      },
      { status: 400 },
    );
  }
  try {
    const stat = await fs.stat(realResolved);
    if (!stat.isDirectory()) {
      return NextResponse.json(
        {
          error: "invalid_path",
          error_description: `Not a directory: ${realResolved}`,
        },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json(
      {
        error: "invalid_path",
        error_description: `Path not accessible: ${realResolved}`,
      },
      { status: 400 },
    );
  }
  const { config: current } = await loadConfig();
  const next = { ...current, specsDir: realResolved };
  await saveConfig(next);
  return NextResponse.json({ config: next });
}
