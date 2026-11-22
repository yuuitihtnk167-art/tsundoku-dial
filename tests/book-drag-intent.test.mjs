import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const helpers = app.slice(app.indexOf("const bookDragScrollEdge ="), app.indexOf("const lockedViewport ="));
const functions = [
  ["updateBookDragTargets", "stopBookAutoScroll"],
  ["startBookAutoScroll", "selectBookForDragging"],
  ["moveBook", "removeDraggedBook"],
].map(([start, end]) => {
  const begin = app.indexOf(`  function ${start}(`);
  const finish = Math.max(app.indexOf(`  function ${end}(`, begin), app.indexOf(`  async function ${end}(`, begin));
  return app.slice(begin, finish);
}).join("\n");
const code = transpileModule(helpers + functions, {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
}).outputText;

function setup(x = 380) {
  const frames = [];
  const positions = [];
  const starts = [];
  const row = { scrollLeft: 400, getBoundingClientRect: () => ({ left: 0, right: 400 }), scrollBy({ left }) { this.scrollLeft += left; } };
  const context = {
    booksRef: { current: [{ id: "book-1", category: "reading" }, { id: "book-2", category: "reading" }] },
    bookAutoScrollFrameRef: { current: null },
    bookPointerStartRef: { current: { pointerId: 1, pointerType: "touch", startX: x, startY: 300, currentX: x, currentY: 300 } },
    draggingBookIdRef: { current: "book-1" },
    dragOriginRef: { current: { x, y: 300 } },
    dragMovedRef: { current: false },
    bookDropTargetRef: { current: null },
    lastReorderTargetRef: { current: "book-1" },
    resolveBookDropTarget: () => null,
    setDeleteTarget() {}, setCategoryTarget() {}, clearLongPressTimer() {},
    setDragPosition: (position) => positions.push(position),
    setBookDragStarted: (started) => starts.push(started),
    getBookCategory: (book) => book.category,
    setBooks: (update) => { context.booksRef.current = update(context.booksRef.current); },
    document: { elementFromPoint: () => ({ closest(selector) {
      if (selector === ".bookshelf-row-scroll") return row;
      if (selector === "[data-book-id]") return { dataset: { bookId: "book-2" } };
      return null;
    } }) },
    window: { innerHeight: 600, scrollY: 0, requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; }, scrollBy() {} },
  };
  vm.runInNewContext(code, context);
  const move = (delta) => context.moveBook({ pointerId: 1, clientX: x + delta, clientY: 300, preventDefault() {} });
  const order = () => Array.from(context.booksRef.current, (book) => book.id);
  return { context, row, frames, positions, starts, move, order };
}

test("端でつかんでも、指の微小な揺れでは並び替え・スクロール・移動表示が始まらない", () => {
  const { context, row, frames, positions, starts, move, order } = setup();
  for (const delta of [0, 1, -1, 4, 8, 11]) move(delta);
  assert.equal(context.dragMovedRef.current, false);
  assert.deepEqual(order(), ["book-1", "book-2"]);
  assert.equal(row.scrollLeft, 400);
  assert.equal(frames.length, 0);
  assert.equal(positions.length, 0);
  assert.equal(starts.length, 0);
});

test("12px動かして初めて移動を開始し、その後は小さな動きにも追従する", () => {
  const { context, row, frames, positions, starts, move, order } = setup();
  move(12);
  assert.equal(context.dragMovedRef.current, true);
  assert.deepEqual(order(), ["book-2", "book-1"]);
  assert.deepEqual(starts, [true]);
  assert.equal(positions.length, 1);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.ok(row.scrollLeft > 400);
  assert.equal(row.scrollLeft - 400, 102);
  move(1);
  assert.equal(positions.length, 2);
  assert.deepEqual(starts, [true]);
});

test("並び替え判定が直接呼ばれても、移動開始前は本を入れ替えない", () => {
  const { context, order } = setup();
  context.updateBookDragTargets(395, 300, "book-1");
  assert.deepEqual(order(), ["book-1", "book-2"]);
});
