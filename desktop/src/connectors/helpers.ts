import type { ConnectorPermission } from "../types.js";

export const connectorLimit = (permission: ConnectorPermission, fallback = 100): number => {
  const configured = Number(permission.settings?.maxItemsPerRun ?? fallback);
  if (!Number.isInteger(configured) || configured < 1 || configured > 10_000) {
    throw new Error("maxItemsPerRun must be an integer between 1 and 10000");
  }
  return configured;
};

export const timeoutMs = (permission: ConnectorPermission, fallback = 10_000): number => {
  const configured = Number(permission.settings?.timeoutMs ?? fallback);
  if (!Number.isInteger(configured) || configured < 100 || configured > 120_000) {
    throw new Error("timeoutMs must be an integer between 100 and 120000");
  }
  return configured;
};

export const envValue = (reference: string | undefined, label: string): string => {
  if (!reference?.startsWith("env:")) throw new Error(`${label} must use an env: credential reference`);
  const value = process.env[reference.slice(4)];
  if (!value) throw new Error(`${label} credential is unavailable`);
  return value;
};

export const assertExactScope = (scope: string, label: string): void => {
  if (!scope || /[*?\[\]>]/.test(scope)) throw new Error(`${label} scopes must be exact and cannot contain wildcards`);
};

export const assertNetworkAllowed = (url: URL, localOnly: boolean, networkEgress: "deny" | "allow-explicit"): void => {
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname.toLowerCase());
  if ((localOnly || networkEgress === "deny") && !loopback) {
    throw new Error("The permission manifest denies non-loopback network egress");
  }
};

export const boundedBody = async (response: Response, maxBytes: number): Promise<string> => {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new Error(`Response exceeds ${maxBytes} byte connector limit`);
  if (!response.body) throw new Error("Response body is unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response exceeds ${maxBytes} byte connector limit`);
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
};
