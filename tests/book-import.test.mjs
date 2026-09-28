import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

async function loadBookImport() {
  const [matchSource, importSource] = await Promise.all([
    readFile(new URL("../src/book-match.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/book-import.ts", import.meta.url), "utf8"),
  ]);
  const options = { compilerOptions: { module: ModuleKind.ES2022, target: ScriptTarget.ES2022 } };
  const matchCode = transpileModule(matchSource, options).outputText;
  const matchUrl = `data:text/javascript;base64,${Buffer.from(matchCode).toString("base64")}`;
  const importCode = transpileModule(importSource, options).outputText
    .replace('"./book-match"', JSON.stringify(matchUrl));
  return import(`data:text/javascript;base64,${Buffer.from(importCode).toString("base64")}`);
}

test("ChatGPTの単一コードブロックから全項目を取り込む", async () => {
  const { parseBookImport } = await loadBookImport();
  const json = JSON.stringify({
    title: " 本のタイトル ",
    author: " 著者 ",
    publisher: " 出版社 ",
    notes: " 本の内容 ",
    isbn: "978-0-306-40615-7",
  });
  assert.deepEqual(parseBookImport(`\`\`\`json\n${json}\n\`\`\``), {
    title: "本のタイトル",
    author: "著者",
    publisher: "出版社",
    notes: "本の内容",
    isbn: "9780306406157",
  });
  assert.equal(parseBookImport(json).title, "本のタイトル");
});

test("不完全または不正な取り込みデータでは入力欄を変更させない", async () => {
  const { parseBookImport } = await loadBookImport();
  const valid = { title: "本", author: "", publisher: "", notes: "", isbn: null };
  assert.throws(() => parseBookImport("説明だけです"));
  assert.throws(() => parseBookImport(JSON.stringify({ ...valid, title: "" })));
  assert.throws(() => parseBookImport(JSON.stringify({ ...valid, notes: undefined })));
  assert.throws(() => parseBookImport(JSON.stringify({ ...valid, notes: "長".repeat(1001) })));
  assert.throws(() => parseBookImport(JSON.stringify({ ...valid, isbn: "9780306406158" })));
});
