import { zipSync, strToU8 } from "fflate";
import { buildBrunoCollection } from "@/lib/bruno-export";

// GET /api/bruno/export?api=<id>
// Streams a .zip containing a Bruno collection generated from the API's
// OpenAPI spec, laid out like ../openapi/bruno/<api>/v1/.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const apiId = new URL(req.url).searchParams.get("api")?.trim();
  if (!apiId) {
    return Response.json(
      { error: "invalid_request", error_description: "api is required" },
      { status: 400 },
    );
  }

  const collection = await buildBrunoCollection(apiId);
  if (!collection) {
    return Response.json(
      { error: "not_found", error_description: `API introuvable : ${apiId}` },
      { status: 404 },
    );
  }

  // fflate expects a nested/flat path→bytes record. Prefix every entry with
  // the collection dir so the archive unzips into <api>/v1/…
  const entries: Record<string, Uint8Array> = {};
  for (const [rel, content] of Object.entries(collection.files)) {
    entries[`${collection.dir}/${rel}`] = strToU8(content);
  }

  const zipped = zipSync(entries, { level: 6 });
  // Copy into a standalone ArrayBuffer so the Response body is a clean
  // BodyInit regardless of the underlying pooled buffer.
  const body = zipped.slice();

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${apiId}-bruno.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
