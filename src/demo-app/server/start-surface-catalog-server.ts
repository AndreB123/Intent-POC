import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { renderSurfaceCatalogIndex, renderSurfacePage } from "../render/render-surface-page";
import { SurfaceDefinition, LibraryVariant } from "../model/types";

export interface SurfaceCatalogServer {
  baseUrl: string;
  setVariant: (variant: LibraryVariant) => void;
  close: () => Promise<void>;
}

export interface StartSurfaceCatalogServerOptions {
  host?: string;
  port?: number;
  initialVariant?: LibraryVariant;
}

function resolveVariant(requestUrl: URL, fallback: LibraryVariant): LibraryVariant {
  const variant = requestUrl.searchParams.get("variant");
  return variant === "v2" ? "v2" : variant === "v1" ? "v1" : fallback;
}

export async function startSurfaceCatalogServer(
  catalog: SurfaceDefinition[],
  options: StartSurfaceCatalogServerOptions = {}
): Promise<SurfaceCatalogServer> {
  const host = options.host ?? "127.0.0.1";
  let variant: LibraryVariant = options.initialVariant ?? "v1";
  const byRoute = new Map(catalog.map((surface) => [`/library/${surface.id}`, surface]));

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const requestUrl = new URL(req.url ?? "/", `http://${host}`);
    const route = requestUrl.pathname;
    const effectiveVariant = resolveVariant(requestUrl, variant);

    if (route === "/" || route === "/library") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(renderSurfaceCatalogIndex(catalog, effectiveVariant));
      return;
    }

    if (route === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    const surface = byRoute.get(route);
    if (surface) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(renderSurfacePage(surface, effectiveVariant));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 0, host, () => resolve());
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://${host}:${address.port}`,
    setVariant(nextVariant: LibraryVariant) {
      variant = nextVariant;
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}