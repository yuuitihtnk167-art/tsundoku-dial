import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

async function loadBookLookup() {
  const source = await readFile(new URL("../src/book-lookup.ts", import.meta.url), "utf8");
  const compiled = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.ES2022,
      target: ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

test("openBDのタイトルと公開書影をISBNから取得する", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.startsWith("https://api.openbd.jp/")) {
      return new Response(JSON.stringify([{ summary: { title: "吾輩は猫である", cover: "" } }]), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(new Blob(["cover"], { type: "image/jpeg" }), {
      headers: { "content-type": "image/jpeg" },
    });
  };

  try {
    const { lookupBookByIsbn } = await loadBookLookup();
    const result = await lookupBookByIsbn("9784101010014");
    assert.equal(result.title, "吾輩は猫である");
    assert.equal(result.cover?.type, "image/jpeg");
    assert.match(requestedUrls[1], /covers\.openlibrary\.org\/b\/isbn\/9784101010014-L\.jpg/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("書誌情報と書影がなくても空の結果を返す", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 404 });

  try {
    const { lookupBookByIsbn } = await loadBookLookup();
    assert.deepEqual(await lookupBookByIsbn("9780000000002"), { title: "", cover: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ISBN先行登録と最上部の重複確認UIが組み込まれている", async () => {
  const [app, lookup, styles] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/book-lookup.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(app, /!cameraActive && addDialogOpen/);
  assert.doesNotMatch(app, /photo && addDialogOpen && <IsbnScanner/);
  assert.match(app, /lookupBookByIsbn\(nextIsbn, controller\.signal\)/);
  assert.match(app, />やめる<\/button>/);
  assert.match(app, /続ける/);
  assert.match(app, /ガイド付きで撮り直す/);
  assert.match(app, /lookingUpBook \|\| !photo/);
  assert.ok(app.indexOf("duplicate-warning") < app.indexOf("!photoUrl"));
  assert.match(lookup, /api\.openbd\.jp\/v1\/get/);
  assert.match(lookup, /covers\.openlibrary\.org\/b\/isbn/);
  assert.match(lookup, /maximumCoverBytes = 10 \* 1024 \* 1024/);
  assert.match(lookup, /slice\(0, 160\)/);
  assert.match(styles, /\.duplicate-actions/);
  assert.match(styles, /\.book-lookup-message/);
});
