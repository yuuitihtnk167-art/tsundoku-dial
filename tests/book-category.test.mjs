import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const source = await readFile(new URL("../src/book-category.ts", import.meta.url), "utf8");
const compiled = transpileModule(source, {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
}).outputText;
const { isOwnedBook, canSetBookCategory, bookCategoryChange } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const categories = ["unclassified", "reading", "reread", "owned", "read"];

test("既存の所有本は読書中にだけ移動でき、保存し直しても所有情報が残る", () => {
  let book = { category: "owned" };
  assert.equal(isOwnedBook(book), true);
  for (let round = 0; round < 2; round += 1) {
    for (const category of categories) {
      assert.equal(canSetBookCategory(book, category), ["owned", "reading"].includes(category));
    }
    book = JSON.parse(JSON.stringify({ ...book, ...bookCategoryChange(book, "reading") }));
    assert.equal(book.owned, true);
    for (const category of ["unclassified", "reread", "read"]) {
      assert.throws(() => bookCategoryChange(book, category), /持っている本/);
    }
    book = { ...book, ...bookCategoryChange(book, "owned") };
    assert.equal(book.owned, true);
  }
});

test("借りた本の移動は制限せず、持っているに変更した時点から所有情報を保持する", () => {
  for (const current of categories.filter((category) => category !== "owned")) {
    const book = { category: current };
    for (const category of categories) assert.equal(canSetBookCategory(book, category), true);
    assert.equal(bookCategoryChange(book, "read").owned, false);
    const owned = { ...book, ...bookCategoryChange(book, "owned") };
    assert.equal(isOwnedBook(owned), true);
    assert.equal(canSetBookCategory(owned, "read"), false);
  }
});

test("修正とドラッグの保存処理で所有本の制限が働き、削除は引き続き使える", async () => {
  const categoryUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
  const storageSource = await readFile(new URL("../src/storage.ts", import.meta.url), "utf8");
  const storageCode = transpileModule(storageSource, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText.replace('"./book-category"', JSON.stringify(categoryUrl));
  const storage = await import(`data:text/javascript;base64,${Buffer.from(storageCode).toString("base64")}`);
  const records = new Map();
  const request = (operation) => {
    const result = {};
    queueMicrotask(() => {
      result.result = operation();
      result.onsuccess?.();
    });
    return result;
  };
  const store = {
    get: (id) => request(() => structuredClone(records.get(id))),
    getAll: () => request(() => structuredClone([...records.values()])),
    put: (book) => request(() => records.set(book.id, structuredClone(book))),
    add: (book) => request(() => records.set(book.id, structuredClone(book))),
    delete: (id) => request(() => records.delete(id)),
  };
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = {
    open: () => request(() => ({
      transaction: () => ({ objectStore: () => store }),
      close() {},
    })),
  };
  try {
    let book = await storage.addBook({ title: "所有本", notes: "", isbn: null, category: "owned", cover: new Blob() });
    book = await storage.updateBook({ ...book, category: "reading" });
    assert.equal((await storage.getBooks())[0].owned, true);
    await assert.rejects(storage.updateBook({ ...book, category: "read" }), /持っている本/);
    await assert.rejects(storage.updateBookCategory(book.id, "reread"), /持っている本/);
    assert.equal((await storage.getBooks())[0].category, "reading");
    book = await storage.updateBookCategory(book.id, "owned");
    await storage.updateBookCategory(book.id, "reading");
    await assert.rejects(storage.updateBookCategory(book.id, "unclassified"), /持っている本/);
    await storage.deleteBook(book.id);
    assert.deepEqual(await storage.getBooks(), []);
  } finally {
    if (previous === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous;
  }
});
