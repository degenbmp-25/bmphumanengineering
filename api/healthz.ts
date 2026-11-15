/**
 * Liveness probe for the Executive Performance MCP deployment.
 *
 * This exists as its own file because Vercel maps one file per route:
 * `api/healthz.ts` -> `/api/healthz`, `api/mcp.ts` -> `/api/mcp`. A probe that
 * lives inside the MCP handler would only answer on the MCP path, which
 * defeats the purpose — the whole point of this route is to answer when the
 * MCP route is broken.
 */

export default function handler(_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }): void {
  res.status(200).json({
    ok: true,
    service: "executive-performance",
    route: "/api/healthz",
  });
}
