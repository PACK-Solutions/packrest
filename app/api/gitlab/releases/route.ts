import { NextResponse } from "next/server";
import { GitlabError, listReleases } from "@/lib/gitlab";

// Lists the project's releases (tag, name, date, whether a bundle.zip asset
// is present) for the tag picker in Settings.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const perPage = new URL(req.url).searchParams.get("per_page");
  const limit = perPage && /^\d+$/.test(perPage) ? Number(perPage) : undefined;
  try {
    const result = await listReleases(limit);
    return NextResponse.json(result);
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
