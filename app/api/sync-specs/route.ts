import { NextResponse } from "next/server";
import { copySpecs } from "@/lib/sync";
import { resetSpecCache } from "@/lib/specs";

// Copies the configured OpenAPI bundles into public/specs/ and busts the
// in-memory spec cache so the new APIs appear on the next page request
// without a server restart.

export const dynamic = "force-dynamic";

export async function POST() {
  const result = await copySpecs();
  if (result.missing) {
    return NextResponse.json(
      {
        error: "source_missing",
        error_description: `Source directory not found: ${result.source}. Check Settings → Specs source.`,
        ...result,
      },
      { status: 404 },
    );
  }
  resetSpecCache();
  return NextResponse.json({
    ...result,
    syncedAt: new Date().toISOString(),
  });
}
