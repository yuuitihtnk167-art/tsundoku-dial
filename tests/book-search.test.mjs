import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const source = await readFile(new URL("../src/book-search.ts", import.meta.url), "utf8");
const compiled = transpileModule(source, {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
}).outputText;
const { searchBooks } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const books = [
  { id: "1", title: "ChatGPTで学ぶ日本史", author: "山田太郎", publisher: "未来社", notes: "近現代の歴史を学ぶ", isbn: "9781234567890", category: "owned" },
  { id: "2", title: "健康の本", author: "山田花子", publisher: "講談社", notes: "首と肩のケア", isbn: null, category: "reading" },
  { id: "3", title: "日本史入門", notes: "", isbn: null, category: "read" },
];
const ids = (query) => searchBooks(books, query).map((book) => book.id);

test("全登録先から書名・著者・出版社・メモ・ISBNの部分一致で検索する", () => {
  assert.deepEqual(ids("日本史"), ["1", "3"]);
  assert.deepEqual(ids("山田"), ["1", "2"]);
  assert.deepEqual(ids("講談"), ["2"]);
  assert.deepEqual(ids("近現代"), ["1"]);
  assert.deepEqual(ids("978123"), ["1"]);
});

test("英字の大小・全角半角を区別せず、複数キーワードを項目をまたいで絞り込む", () => {
  assert.deepEqual(ids("ｃＨＡＴｇｐｔ　未来社  歴史"), ["1"]);
  assert.deepEqual(ids("日本史 山田"), ["1"]);
  assert.deepEqual(ids("日本史 ケア"), []);
});

test("空欄と該当なしは空の結果を返し、本の順序やデータを変更しない", () => {
  const before = structuredClone(books);
  assert.deepEqual(ids(" 　\n"), []);
  assert.deepEqual(ids("該当なし"), []);
  assert.deepEqual(searchBooks([], "本"), []);
  const result = searchBooks(books, "日本史");
  assert.equal(result[0], books[0]);
  assert.deepEqual(books, before);
});
