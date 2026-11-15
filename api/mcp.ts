/**
 * Executive Performance — MCP server over a Vercel Node function.
 *
 * The tool implementation is vendored under /api/_lib/executive-performance
 * and is the SAME code the self-hosted Express server runs (see
 * vault/projects/executive-performance-plugin/src/server.ts). Only the
 * transport wrapper differs.
 *
 * WHY THE IMPORTS ARE DYNAMIC
 * ----------------------------
 * A static import that throws at module load kills the whole function with a
 * bare 500 and no body — which is exactly what happened on the sibling
 * Growth Audit deployment before this pattern was adopted. Loading each stage
 * inside the handler means a load failure is caught, named, and returned as
 * JSON, so a failure tells us WHICH stage broke instead of guessing.
 *
 * WHY THIS TRANSPORT (three dead ends, measured on the sibling deployment):
 *   - The SDK's Node wrapper (StreamableHTTPServerTransport) converts Node
 *     req/res via @hono/node-server and calls `outgoing.writeHead()`, which
 *     Vercel's VercelResponse does not implement.
 *   - Exporting `{ fetch }` is an Edge-runtime shape; Vercel's Node runtime
 *     expects a function export and invoked the object as a handler.
 *   - So: keep Vercel's `(req, res)` function export, and bridge to the SDK's
 *     web-standard transport by hand. Build a Request, get a Response, write
 *     it out. No SDK conversion layer, no writeHead, no object export.
 *
 * STORAGE POSTURE: a serverless invocation has an ephemeral filesystem, so
 * this mounts the MemoryStore. That store reports `retainsLeads: false`, and
 * the request tool checks that flag — it hands the user an email handoff
 * instead of claiming a capture it cannot deliver. A tool that says "we'll be
 * in touch" while the record evaporates is worse than no tool.
 */

type Loaded = {
  transport: typeof import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js").WebStandardStreamableHTTPServerTransport;
  buildServer: typeof import("./_lib/executive-performance/server.js").buildServer;
  MemoryStore: typeof import("./_lib/executive-performance/store-memory.js").MemoryStore;
};

let cached: Loaded | null = null;

async function loadStages(): Promise<Loaded> {
  if (cached) return cached;

  const stage: string[] = [];
  try {
    const sdk = await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
    stage.push("sdk:ok");
    const srv = await import("./_lib/executive-performance/server.js");
    stage.push("server:ok");
    const mem = await import("./_lib/executive-performance/store-memory.js");
    stage.push("store:ok");

    cached = {
      transport: sdk.WebStandardStreamableHTTPServerTransport,
      buildServer: srv.buildServer,
      MemoryStore: mem.MemoryStore,
    };
    return cached;
  } catch (err) {
    throw new Error(
      `load failed after [${stage.join(",") || "none"}]: ` +
        (err instanceof Error ? err.message : String(err))
    );
  }
}

/** Build an absolute URL from Vercel's request (req.url is a path only). */
function absoluteUrl(req: { url?: string; headers: Record<string, unknown> }): string {
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const path = req.url ?? "/api/mcp";
  return `${proto}://${host}${path.startsWith("/") ? path : `/${path}`}`;
}

async function writeResponse(
  res: {
    statusCode: number;
    headersSent: boolean;
    setHeader(k: string, v: unknown): void;
    getHeader(k: string): unknown;
    end(b?: unknown): void;
    status(n: number): unknown;
    json(b: unknown): void;
  },
  response: Response
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      const existing = res.getHeader("set-cookie");
      const list = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
      res.setHeader(key, [...list, value]);
    } else {
      res.setHeader(key, value);
    }
  });

  if (!response.body) {
    res.end();
    return;
  }

  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

export default async function handler(
  req: {
    method?: string;
    url?: string;
    headers: Record<string, unknown>;
    body?: unknown;
  },
  res: {
    statusCode: number;
    headersSent: boolean;
    setHeader(k: string, v: unknown): void;
    getHeader(k: string): unknown;
    end(b?: unknown): void;
    status(n: number): unknown;
    json(b: unknown): void;
  }
): Promise<void> {
  const path = (req.url ?? "").split("?")[0];

  // Liveness probe as its own route file (api/healthz.ts). If this answers,
  // the bundle loaded, so a failure on /api/mcp is in the MCP request path.
  if (path === "/api/healthz") {
    res.status(200).json({
      ok: true,
      service: "executive-performance",
      route: "/api/healthz",
    });
    return;
  }

  try {
    const { transport: Transport, buildServer, MemoryStore } = await loadStages();

    const store = new MemoryStore();
    await store.init();

    const server = buildServer(store, store.capabilities);
    const transport = new Transport({ sessionIdGenerator: undefined });

    const method = req.method ?? "GET";
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(", "));
    }

    let body: string | undefined;
    if (method !== "GET" && method !== "HEAD") {
      if (typeof req.body === "string") body = req.body;
      else if (req.body && typeof req.body === "object") body = JSON.stringify(req.body);
    }

    const request = new Request(absoluteUrl(req), { method, headers, body });

    await server.connect(transport);
    const response = await transport.handleRequest(request);
    await writeResponse(res, response);
  } catch (err) {
    console.error("[mcp] request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "mcp_request_failed",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? (err.stack ?? "").slice(0, 1200) : undefined,
      });
    }
  }
}
