import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("GitHub Pages用の静的アプリを生成する", async () => {
  const [html, app, storage, manifest, serviceWorker] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../dist/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../dist/sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<title>積読ダイヤル \| 表紙から育てる本棚<\/title>/);
  assert.match(html, /(?:src|href)="\/tsundoku-dial\/assets\//);
  assert.match(app, /capture="environment"/);
  assert.doesNotMatch(app, /fetch\(|\/api\//);
  assert.match(app, /maximum-scale=5\.0, user-scalable=yes/);
  assert.match(storage, /indexedDB\.open/);
  assert.match(storage, /createObjectStore\(BOOK_STORE/);
  assert.match(html, /rel="manifest" href="\/tsundoku-dial\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.doesNotMatch(html, /\/src\/main\.tsx/);
  assert.match(html, /maximum-scale=1\.0, user-scalable=no/);

  const parsedManifest = JSON.parse(manifest);
  assert.equal(parsedManifest.display, "standalone");
  assert.equal(parsedManifest.start_url, "/tsundoku-dial/");
  assert.deepEqual(
    parsedManifest.icons.map(({ sizes }) => sizes),
    ["192x192", "512x512"],
  );
  assert.match(serviceWorker, /tsundoku-dial-v2/);
  assert.match(serviceWorker, /caches\.delete/);
});
