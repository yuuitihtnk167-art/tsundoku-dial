import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

async function loadBookDropModule() {
  const source = await readFile(new URL("../src/book-drop.ts", import.meta.url), "utf8");
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

test("点灯中の分類先をドラッグ終了時に安全に確定する", async () => {
  const { isAvailableCategoryDrop, resolveCompletedDropTarget } = await loadBookDropModule();
  const reread = { type: "category", category: "reread", bookId: null };
  const reading = { type: "category", category: "reading", bookId: "book-2" };
  const deletion = { type: "delete" };

  assert.deepEqual(resolveCompletedDropTarget(null, reread, "release"), reread);
  assert.deepEqual(resolveCompletedDropTarget(reading, reread, "release"), reading);
  assert.deepEqual(resolveCompletedDropTarget(deletion, reread, "release"), deletion);
  assert.equal(resolveCompletedDropTarget(null, reread, "cancel"), null);
  assert.equal(resolveCompletedDropTarget(null, deletion, "cancel"), null);
  for (const category of ["unclassified", "reread", "read", "owned", "reading"]) {
    const target = { type: "category", category, bookId: null };
    assert.deepEqual(resolveCompletedDropTarget(null, target, "release"), target);
  }
  assert.equal(isAvailableCategoryDrop("reread", "unclassified"), true);
  assert.equal(isAvailableCategoryDrop("unclassified", "unclassified"), false);
  assert.equal(isAvailableCategoryDrop(undefined, "unclassified"), false);
});
