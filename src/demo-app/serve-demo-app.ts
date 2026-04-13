import { log } from "../shared/log";
import { LibraryVariant } from "./model/types";
import { startIntentStudioServer } from "./server/start-intent-studio-server";

export interface ServeDemoAppOptions {
  host?: string;
  port?: number;
  variant?: LibraryVariant;
  configPath?: string;
}

export async function serveDemoApp(options: ServeDemoAppOptions = {}): Promise<void> {
  const server = await startIntentStudioServer({
    host: options.host,
    port: options.port,
    initialVariant: options.variant,
    configPath: options.configPath
  });

  log.info("Demo app ready.", {
    baseUrl: server.baseUrl,
    studioUrl: `${server.baseUrl}/`,
    catalogUrl: `${server.baseUrl}/library`,
    healthUrl: `${server.baseUrl}/health`,
    variant: options.variant ?? "v1",
    configPath: options.configPath ?? "./intent-poc.yaml"
  });

  await new Promise<void>((resolve, reject) => {
    let closing = false;

    const shutdown = async () => {
      if (closing) {
        return;
      }

      closing = true;
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);

      try {
        await server.close();
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    const onSignal = () => {
      void shutdown();
    };

    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}