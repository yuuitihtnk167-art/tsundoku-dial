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

  assert.deepEqual(resolveCompletedDropTarget(null, reread, "release", true), reread);
  assert.deepEqual(resolveCompletedDropTarget(reading, reread, "release", true), reading);
  assert.deepEqual(resolveCompletedDropTarget(deletion, reread, "release", true), deletion);
  assert.deepEqual(resolveCompletedDropTarget(null, reread, "cancel", true), reread);
  assert.equal(resolveCompletedDropTarget(null, reread, "cancel", false), null);
  assert.equal(resolveCompletedDropTarget(null, deletion, "cancel", true), null);
  assert.equal(isAvailableCategoryDrop("reread", "unclassified"), true);
  assert.equal(isAvailableCategoryDrop("unclassified", "unclassified"), false);
  assert.equal(isAvailableCategoryDrop(undefined, "unclassified"), false);
});
