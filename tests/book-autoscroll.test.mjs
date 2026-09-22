import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const helpers = app.slice(
  app.indexOf("const bookDragScrollEdge ="),
  app.indexOf("const lockedViewport ="),
);
const scrollFunction = app.slice(
  app.indexOf("  function startBookAutoScroll()"),
  app.indexOf("  function selectBookForDragging("),
);
const compiled = transpileModule(helpers + scrollFunction, {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
}).outputText;

function createDrag({ x = 395, inShelf = true, dropType = "category" } = {}) {
  const frames = [];
  const targets = [];
  const pageScrolls = [];
  const row = {
    scrollLeft: 400,
    getBoundingClientRect: () => ({ left: 0, right: 400 }),
    scrollBy({ left }) { this.scrollLeft += left; },
  };
  const dropZone = { dataset: { bookDrop: dropType } };
  const context = {
    bookAutoScrollFrameRef: { current: null },
    bookPointerStartRef: { current: { currentX: x, currentY: 300 } },
    draggingBookIdRef: { current: "book-1" },
    dragMovedRef: { current: false },
    document: {
      elementFromPoint: () => ({
        closest(selector) {
          if (selector === ".bookshelf-row-scroll") return inShelf ? row : null;
          if (selector === "[data-book-drop]") return dropZone;
          return null;
        },
      }),
    },
    window: {
      innerHeight: 600,
      scrollY: 0,
      requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
      scrollBy(delta) { pageScrolls.push(delta); },
    },
    updateBookDragTargets: (...args) => targets.push(args),
  };
  vm.runInNewContext(compiled, context);
  context.startBookAutoScroll();
  return { context, row, frames, targets, pageScrolls };
}

for (const [direction, x, sign] of [["右", 395, 1], ["左", 5, -1]]) {
  test(`本棚の${direction}端で本を保持すると分類領域内でも横スクロールが続く`, () => {
    const { context, row, frames, targets, pageScrolls } = createDrag({ x });
    const initial = row.scrollLeft;
    frames.shift()();
    assert.ok((row.scrollLeft - initial) * sign > 0);
    assert.equal(frames.length, 1);
    const afterFirstFrame = row.scrollLeft;
    frames.shift()();
    assert.ok((row.scrollLeft - afterFirstFrame) * sign > 0);
    assert.equal(targets.length, 2);
    assert.deepEqual(targets[1], [x, 300, "book-1"]);
    assert.equal(context.dragMovedRef.current, true);
    assert.equal(pageScrolls.length, 0);
    context.draggingBookIdRef.current = null;
    frames.shift()();
    assert.equal(frames.length, 0);
  });
}

test("本棚以外の分類パネルと削除領域では自動スクロールしない", () => {
  for (const dropType of ["category", "delete"]) {
    const { context, row, frames, targets, pageScrolls } = createDrag({ inShelf: false, dropType });
    context.bookPointerStartRef.current.currentY = 595;
    frames.shift()();
    assert.equal(row.scrollLeft, 400);
    assert.equal(frames.length, 0);
    assert.equal(targets.length, 0);
    assert.equal(pageScrolls.length, 0);
  }
});
