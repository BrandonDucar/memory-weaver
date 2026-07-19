import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Memory Weaver workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Memory Weaver<\/title>/i);
  assert.match(html, /Memory Weaver/);
  assert.match(html, /Portable Knowledge Workspace/);
  assert.match(html, /Populated demo/);
  assert.match(html, /Device local/);
  assert.match(html, /Warper Keeper product brief/);
  assert.match(html, /Weave now/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships product metadata and removes disposable starter files", async () => {
  const [page, layout, manifest, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<WeaverApp \/>/);
  assert.match(layout, /manifest:\s*"\/manifest\.webmanifest"/);
  assert.match(manifest, /"display": "standalone"/);
  assert.match(packageJson, /"name": "memory-weaver"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});

test("declares the source privacy boundary honestly", async () => {
  const app = await readFile(new URL("../app/WeaverApp.tsx", import.meta.url), "utf8");
  assert.match(app, /browser calls GitHub directly/);
  assert.match(app, /key is held in memory for this tab/);
  assert.match(app, /No DreamNet backend receives imported source content/);
  assert.doesNotMatch(app, /zero-knowledge|end-to-end encrypted|military-grade/i);
});
