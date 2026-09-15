import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function bundledCco(appRoot: string) {
  return join(appRoot, "vendor", "cco", "cco");
}

// Called by the host launcher, before it imports the gateway/Pi runtime.
// Workers inherit this one installation-wide Pi directory, even though each
// worker has a different MARGIN_DATA_DIR.
export function configureInstallation(
  appRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const dataDir = resolve(
    (environment.MARGIN_DATA_DIR ?? join(appRoot, ".margin-data"))
      .replace(/^~(?=\/|$)/, homedir()),
  );
  const piDir = join(dataDir, "pi");
  const configFile = join(dataDir, "installation.json");
  if (existsSync(configFile)) {
    const config = JSON.parse(readFileSync(configFile, "utf8"));
    if (config.version !== 1 || !Number.isInteger(config.port) ||
        config.port < 1024 || config.port > 65535)
      throw new Error("Invalid installation.json; preserve it and correct its version/port.");
    environment.PORT ??= String(config.port);
    if (typeof config.cookieName === "string" && /^[a-zA-Z0-9_]+$/.test(config.cookieName))
      environment.MARGIN_LAUNCHER_COOKIE ??= config.cookieName;
  }
  mkdirSync(piDir, { recursive: true, mode: 0o700 });
  environment.MARGIN_DATA_DIR = dataDir;
  environment.PI_CODING_AGENT_DIR = piDir;
  return { dataDir, piDir, cco: bundledCco(appRoot) };
}
