import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const functions = [
  ["selectBookForDragging", "listenForBookDragEvents"],
  ["startBookPress", "moveBook"],
  ["finishBookPress", "openBook"],
].map(([start, end]) => source.slice(source.indexOf(`  function ${start}(`), source.indexOf(`  function ${end}(`))).join("\n");
const code = transpileModule(functions, {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
}).outputText;

function setup(fromSearch = true) {
  const calls = [];
  const timers = [];
  const frames = [];
  const captureSource = { setPointerCapture: (id) => calls.push(["capture-main", id]) };
  const dialog = { open: fromSearch, close() { this.open = false; calls.push(["close-search"]); } };
  const button = {
    setPointerCapture: (id) => calls.push(["capture-button", id]),
    closest: (selector) => selector === "main" ? captureSource : fromSearch ? dialog : null,
  };
  const context = {
    window: { setTimeout: (callback) => timers.push(callback), requestAnimationFrame: (callback) => frames.push(callback) },
    navigator: { vibrate() {} },
    document: { querySelectorAll: () => [{ dataset: { bookId: "book-1" }, scrollIntoView: () => calls.push(["reveal-book"]) }] },
    searchDialogRef: { current: dialog },
    booksRef: { current: [{ id: "book-1", category: "owned" }] },
    getBookCategory: (book) => book.category,
    bookPointerStartRef: { current: null },
    selectedBookIdRef: { current: null },
    draggingBookIdRef: { current: null },
    dragOriginRef: { current: null },
    dragMovedRef: { current: false },
    bookDropTargetRef: { current: null },
    lastReorderTargetRef: { current: null },
    suppressBookClickRef: { current: false },
    longPressTimerRef: { current: null },
    bookDragListenersCleanupRef: { current: null },
    clearLongPressTimer() {}, stopBookAutoScroll() {}, clearBookSelection() {},
    listenForBookDragEvents: (target, id) => calls.push(["listen", target, id]),
    resolveBookDropTarget: () => { calls.push(["resolve-drop"]); return { type: "category", category: "reading", bookId: null }; },
    resolveCompletedDropTarget: (final, highlighted, reason) => reason === "cancel" ? null : final ?? highlighted,
    classifyDraggedBook: (...args) => calls.push(["classify", ...args]),
    removeDraggedBook: () => calls.push(["delete"]),
    persistCurrentBookOrder: () => calls.push(["reorder"]),
  };
  for (const name of ["setSelectedBookId", "setDraggingBookId", "setDragPosition", "setDeleteTarget", "setCategoryTarget", "setActiveCategory"]) {
    context[name] = (value) => calls.push([name, value]);
  }
  vm.runInNewContext(code, context);
  const event = { isPrimary: true, pointerType: "touch", pointerId: 7, button: 0, clientX: 100, clientY: 200, currentTarget: button };
  return { context, calls, timers, frames, dialog, captureSource, event };
}

test("検索結果も通常と同じ長押し時間でつかみ、ポインターを本棚へ引き継ぐ", () => {
  const { context, calls, timers, frames, dialog, captureSource, event } = setup();
  context.startBookPress(event, "book-1");
  assert.equal(context.draggingBookIdRef.current, null);
  assert.equal(dialog.open, true);
  timers.shift()();
  assert.equal(context.draggingBookIdRef.current, "book-1");
  assert.equal(dialog.open, false);
  assert.equal(context.bookPointerStartRef.current.source, captureSource);
  assert.ok(calls.some(([name, value]) => name === "setActiveCategory" && value === "owned"));
  assert.ok(calls.some(([name, target]) => name === "listen" && target === captureSource));
  frames.shift()();
  assert.ok(calls.some(([name]) => name === "reveal-book"));
});

test("つかんだ直後に指を離しても背景の移動先へ誤って分類しない", () => {
  const { context, calls, timers, event } = setup();
  context.startBookPress(event, "book-1");
  timers.shift()();
  context.finishBookPress(event, "release");
  assert.equal(context.selectedBookIdRef.current, "book-1");
  assert.equal(context.draggingBookIdRef.current, null);
  assert.equal(calls.some(([name]) => ["resolve-drop", "classify", "delete"].includes(name)), false);
});

test("移動して離すと既存の分類処理へ渡し、キャンセル時は分類しない", () => {
  for (const reason of ["release", "cancel"]) {
    const { context, calls, timers, event } = setup();
    context.startBookPress(event, "book-1");
    timers.shift()();
    context.dragMovedRef.current = true;
    context.finishBookPress(event, reason);
    assert.equal(calls.some(([name]) => name === "classify"), reason === "release");
  }
});

test("通常の本棚からつかむ場合は検索画面の引き継ぎ処理を実行しない", () => {
  const { context, calls, timers, frames, event } = setup(false);
  context.startBookPress(event, "book-1");
  timers.shift()();
  assert.equal(context.draggingBookIdRef.current, "book-1");
  assert.equal(calls.some(([name]) => name === "capture-main" || name === "close-search"), false);
  assert.equal(frames.length, 0);
});

test("通常の本棚でも移動せず離した場合は新しく表示された削除先を確定しない", () => {
  const { context, calls, timers, event } = setup(false);
  context.startBookPress(event, "book-1");
  timers.shift()();
  context.finishBookPress(event, "release");
  assert.equal(context.selectedBookIdRef.current, "book-1");
  assert.equal(calls.some(([name]) => ["resolve-drop", "classify", "delete"].includes(name)), false);
});

test("本を移動して固定削除エリアで離すと既存の削除確認へ進み、キャンセル時は進まない", () => {
  for (const reason of ["release", "cancel"]) {
    const { context, calls, timers, event } = setup(false);
    context.startBookPress(event, "book-1");
    timers.shift()();
    context.dragMovedRef.current = true;
    context.resolveBookDropTarget = () => ({ type: "delete" });
    context.finishBookPress(event, reason);
    assert.equal(calls.some(([name]) => name === "delete"), reason === "release");
    assert.equal(calls.some(([name]) => name === "classify"), false);
  }
});
