import { listApis, loadSpec, listEndpoints } from "@/lib/specs";

// GET /api/endpoints
// Lightweight index of every (apiId, method, path, operationId) across the
// loaded specs. The Bruno importer fetches it once to match imported requests
// back to a concrete operation page.

export const dynamic = "force-dynamic";

export interface EndpointIndexEntry {
  apiId: string;
  method: string;
  path: string;
  operationId: string;
}

export async function GET() {
  const ids = await listApis();
  const endpoints: EndpointIndexEntry[] = [];
  for (const id of ids) {
    const doc = await loadSpec(id);
    if (!doc) continue;
    for (const e of listEndpoints(doc, id)) {
      endpoints.push({
        apiId: id,
        method: e.method.toUpperCase(),
        path: e.path,
        operationId: e.operationId,
      });
    }
  }
  return Response.json({ endpoints });
}
