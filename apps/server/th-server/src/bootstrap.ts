import { loadServerEnvironment } from "./environment.js";

export async function loadServerApplication(
  rootDir: string,
): Promise<typeof import("./app.js")> {
  loadServerEnvironment(rootDir);
  return import("./app.js");
}
