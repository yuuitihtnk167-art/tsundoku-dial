import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

async function loadBackupModule() {
  const source = await readFile(new URL("../src/backup.ts", import.meta.url), "utf8");
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

function sampleBook() {
  return {
    id: "book-1",
    title: "バックアップする本",
    notes: "メモ",
    isbn: "9784101010014",
    createdAt: "2026-08-16T01:02:03.000Z",
    sortOrder: 42,
    category: "reading",
    cover: new Blob([Uint8Array.from([1, 2, 3, 4])], { type: "image/jpeg" }),
    original: new Blob([Uint8Array.from([5, 6, 7, 8, 9])], { type: "image/jpeg" }),
    crop: { left: 1, top: 2, right: 98, bottom: 99 },
  };
}

test("画像を含む全書籍データをバックアップして復元できる", async () => {
  const { createCompleteBackup, parseCompleteBackup } = await loadBackupModule();
  const backup = await createCompleteBackup([sampleBook()], "2026-08-16T10:00:00.000Z");
  const parsed = await parseCompleteBackup(backup);

  assert.equal(parsed.createdAt, "2026-08-16T10:00:00.000Z");
  assert.equal(parsed.books.length, 1);
  assert.deepEqual(
    { ...parsed.books[0], cover: undefined, original: undefined },
    { ...sampleBook(), cover: undefined, original: undefined },
  );
  assert.deepEqual(new Uint8Array(await parsed.books[0].cover.arrayBuffer()), Uint8Array.from([1, 2, 3, 4]));
  assert.deepEqual(new Uint8Array(await parsed.books[0].original.arrayBuffer()), Uint8Array.from([5, 6, 7, 8, 9]));
});

test("破損した画像を復元前に拒否する", async () => {
  const { createCompleteBackup, parseCompleteBackup } = await loadBackupModule();
  const backup = await createCompleteBackup([sampleBook()]);
  const document = JSON.parse(await backup.text());
  document.books[0].cover.base64 = "CQgHBg==";

  await assert.rejects(
    parseCompleteBackup(new Blob([JSON.stringify(document)], { type: "application/json" })),
    /画像が壊れています/,
  );
});

test("異なる形式と重複した書籍IDを拒否する", async () => {
  const { createCompleteBackup, parseCompleteBackup } = await loadBackupModule();
  await assert.rejects(
    parseCompleteBackup(new Blob([JSON.stringify({ format: "other", version: 1 })])),
    /対応するバックアップファイルではありません/,
  );

  const backup = await createCompleteBackup([sampleBook(), sampleBook()]);
  await assert.rejects(parseCompleteBackup(backup), /同じ書籍IDが重複しています/);
});
