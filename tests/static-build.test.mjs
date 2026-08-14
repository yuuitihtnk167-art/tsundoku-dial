import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("GitHub Pages用の静的アプリを生成する", async () => {
  const [html, app, storage] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/storage.ts", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<title>積読ダイヤル \| 表紙から育てる本棚<\/title>/);
  assert.match(html, /(?:src|href)="\/tsundoku-dial\/assets\//);
  assert.match(app, /capture="environment"/);
  assert.doesNotMatch(app, /fetch\(|\/api\//);
  assert.match(storage, /indexedDB\.open/);
  assert.match(storage, /createObjectStore\(BOOK_STORE/);
});
