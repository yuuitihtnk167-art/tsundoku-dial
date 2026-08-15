import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

async function loadBookMatch() {
  const source = await readFile(new URL("../src/book-match.ts", import.meta.url), "utf8");
  const compiled = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.ES2022,
      target: ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

test("ISBN-13だけを検証して正規化する", async () => {
  const { normalizeIsbn } = await loadBookMatch();

  assert.equal(normalizeIsbn("978-0-306-40615-7"), "9780306406157");
  assert.equal(normalizeIsbn("9780306406158"), null);
  assert.equal(normalizeIsbn("1921234567890"), null);
  assert.equal(normalizeIsbn("9790123456789"), null);
});

test("タイトルの完全一致と類似を判定する", async () => {
  const { getTitleMatch } = await loadBookMatch();

  assert.equal(getTitleMatch(" 吾輩は猫である ", "吾輩は猫である"), "exact");
  assert.equal(getTitleMatch("吾輩は猫である", "吾輩は猫であゐ"), "similar");
  assert.equal(getTitleMatch("本", "ほん"), null);
  assert.equal(getTitleMatch("タイトル未設定", "タイトル未設定"), null);
});

test("ISBN読取・保存・重複確認がアプリに組み込まれている", async () => {
  const [app, scanner, storage, styles, serviceWorker] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/IsbnScanner.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(app, /<IsbnScanner/);
  assert.match(app, /duplicateCandidates/);
  assert.match(app, /ISBNが一致/);
  assert.match(app, /タイトルが一致/);
  assert.match(app, /タイトルが類似/);
  assert.match(app, /book\.id === editingBookId/);
  assert.match(scanner, /BrowserMultiFormatOneDReader/);
  assert.match(scanner, /BarcodeFormat\.EAN_13/);
  assert.match(scanner, /ISBN以外のバーコード/);
  assert.match(scanner, /scanTimeoutMilliseconds = 15_000/);
  assert.doesNotMatch(scanner, /fetch\(/);
  assert.match(storage, /isbn: input\.isbn/);
  assert.match(styles, /\.isbn-panel/);
  assert.match(styles, /\.duplicate-warning/);
  assert.match(serviceWorker, /tsundoku-dial-v20/);
});
