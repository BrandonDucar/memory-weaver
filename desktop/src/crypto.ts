import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign as cryptoSign, type KeyObject } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

export const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const loadOrCreateVaultKey = async (keyPath: string): Promise<Buffer> => {
  await mkdir(path.dirname(keyPath), { recursive: true });
  try {
    const encoded = (await readFile(keyPath, "utf8")).trim();
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) throw new Error("invalid key length");
    return key;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code && code !== "ENOENT") throw error;
    const key = randomBytes(32);
    await writeFile(keyPath, key.toString("base64"), { encoding: "utf8", flag: "wx" });
    await chmod(keyPath, 0o600).catch(() => undefined);
    return key;
  }
};

export interface ReceiptSigner {
  privateKey: KeyObject;
  publicKeyPem: string;
  keyId: string;
}

export const loadOrCreateReceiptSigner = async (privateKeyPath: string, publicKeyPath: string): Promise<ReceiptSigner> => {
  await mkdir(path.dirname(privateKeyPath), { recursive: true });
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(await readFile(privateKeyPath, "utf8"));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code && code !== "ENOENT") throw error;
    const generated = generateKeyPairSync("ed25519");
    privateKey = generated.privateKey;
    const encoded = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    await writeFile(privateKeyPath, encoded, { encoding: "utf8", flag: "wx" });
    await chmod(privateKeyPath, 0o600).catch(() => undefined);
  }
  const publicKey = createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  await writeFile(publicKeyPath, publicKeyPem, { encoding: "utf8" });
  const keyId = `ed25519:${sha256(publicKey.export({ type: "spki", format: "der" })).slice(0, 24)}`;
  return { privateKey, publicKeyPem, keyId };
};

export const encryptText = (value: string, key: Buffer): { ciphertext: string; iv: string; tag: string } => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
};

export const decryptText = (payload: { ciphertext: string; iv: string; tag: string }, key: Buffer): string => {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8");
};

export const signReceipt = (receipt: Omit<import("./types.js").MeshReceipt, "signature">, signer: ReceiptSigner): string =>
  cryptoSign(null, Buffer.from(stableJson(receipt)), signer.privateKey).toString("base64url");
