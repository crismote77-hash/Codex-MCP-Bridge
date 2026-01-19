import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer, type SharedDependencies } from "./server.js";

// Extract SDK transport parameter types for type-safe adaptation
type TransportHandleRequest = StreamableHTTPServerTransport["handleRequest"];
type TransportRequest = Parameters<TransportHandleRequest>[0];
type TransportResponse = Parameters<TransportHandleRequest>[1];
type TransportBody = Parameters<TransportHandleRequest>[2];

// Local types that match the Express-like interface from createMcpExpressApp
type HttpRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type HttpResponse = {
  status: (code: number) => HttpResponse;
  json: (body: unknown) => void;
  headersSent: boolean;
};

type HttpServerOptions = {
  host: string;
  port: number;
};

type HttpServerHandle = {
  close: () => Promise<void>;
};

function adaptToTransport(
  req: HttpRequest,
  res: HttpResponse,
): { req: TransportRequest; res: TransportResponse; body: TransportBody } {
  return {
    req: req as unknown as TransportRequest,
    res: res as unknown as TransportResponse,
    body: req.body as TransportBody,
  };
}

export async function startHttpServer(
  deps: SharedDependencies,
  info: { name: string; version: string },
  opts: HttpServerOptions,
): Promise<HttpServerHandle> {
  const app = createMcpExpressApp({ host: opts.host });
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const servers = new Map<string, McpServer>();

  const registerTransport = (
    sessionId: string,
    transport: StreamableHTTPServerTransport,
    server: McpServer,
  ) => {
    transports.set(sessionId, transport);
    servers.set(sessionId, server);
  };

  const cleanupTransport = async (sessionId: string) => {
    const server = servers.get(sessionId);
    if (server) {
      try {
        await server.close();
      } catch (error) {
        deps.logger.error("Error closing MCP server", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      servers.delete(sessionId);
    }
    transports.delete(sessionId);
  };

  app.all("/mcp", async (req: HttpRequest, res: HttpResponse) => {
    try {
      const sessionId = req.headers["mcp-session-id"];
      const sessionKey = typeof sessionId === "string" ? sessionId : undefined;
      const transport = sessionKey ? transports.get(sessionKey) : undefined;

      if (!transport) {
        if (req.method === "POST" && isInitializeRequest(req.body)) {
          const server = createMcpServer(deps, info);
          const transportInstance = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              registerTransport(sid, transportInstance, server);
            },
          });

          transportInstance.onclose = () => {
            const sid = transportInstance.sessionId;
            if (sid) void cleanupTransport(sid);
          };

          await server.connect(transportInstance);
          const adapted = adaptToTransport(req, res);
          await transportInstance.handleRequest(
            adapted.req,
            adapted.res,
            adapted.body,
          );
          return;
        }

        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
        return;
      }

      const adapted = adaptToTransport(req, res);
      await transport.handleRequest(adapted.req, adapted.res, adapted.body);
    } catch (error) {
      deps.logger.error("Error handling MCP HTTP request", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const httpServer = await listen(app, opts.host, opts.port);
  deps.logger.info("Server running on Streamable HTTP", {
    host: opts.host,
    port: opts.port,
    endpoint: "/mcp",
  });

  return {
    close: async () => {
      const sessionIds = Array.from(transports.keys());
      const closeResults = await Promise.allSettled(
        sessionIds.map(async (sessionId) => {
          const transport = transports.get(sessionId);
          if (transport) {
            await transport.close();
          }
          await cleanupTransport(sessionId);
        }),
      );

      for (let i = 0; i < closeResults.length; i++) {
        const result = closeResults[i];
        if (result.status === "rejected") {
          deps.logger.error("Error closing HTTP transport", {
            sessionId: sessionIds[i],
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          });
        }
      }

      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export class HttpServerError extends Error {
  name = "HttpServerError";
  code?: string;
}

function formatPortError(
  error: NodeJS.ErrnoException,
  host: string,
  port: number,
): string {
  if (error.code === "EADDRINUSE") {
    return `Address ${host}:${port} is already in use.`;
  }
  if (error.code === "EACCES") {
    return `Permission denied binding to ${host}:${port}.`;
  }
  return error.message;
}

async function listen(
  app: ReturnType<typeof createMcpExpressApp>,
  host: string,
  port: number,
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.on("error", (error: NodeJS.ErrnoException) => {
      const err = error as NodeJS.ErrnoException;
      const message = formatPortError(err, host, port);
      const wrapped = new HttpServerError(message);
      wrapped.code = err.code;
      reject(wrapped);
    });
  });
}
