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

function createDrag({ x = 395, y = 300, inShelf = true, inCategory = false, dropType = "category", moved = true, scrollable = true } = {}) {
  const frames = [];
  const targets = [];
  const pageScrolls = [];
  const row = {
    scrollLeft: 400,
    getBoundingClientRect: () => ({ left: 0, right: 400 }),
    scrollBy({ left }) { this.scrollLeft += left; },
  };
  const dropZone = { dataset: { bookDrop: dropType } };
  const surface = { inShelf, inCategory };
  const context = {
    bookAutoScrollFrameRef: { current: null },
    bookPointerStartRef: { current: { currentX: x, currentY: y } },
    draggingBookIdRef: { current: "book-1" },
    dragMovedRef: { current: moved },
    document: {
      elementFromPoint: () => ({
        closest(selector) {
          if (selector === ".bookshelf-row-scroll") return surface.inShelf ? row : null;
          if (selector === ".bookshelf-category") return surface.inCategory ? {} : null;
          if (selector === "[data-book-drop]") return dropZone;
          return null;
        },
      }),
    },
    window: {
      innerHeight: 600,
      scrollY: 0,
      requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
      scrollBy(delta) { pageScrolls.push(delta); if (scrollable) this.scrollY += delta.top; },
    },
    updateBookDragTargets: (...args) => targets.push(args),
  };
  vm.runInNewContext(compiled, context);
  context.startBookAutoScroll();
  return { context, row, frames, targets, pageScrolls, surface };
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

test("長押しだけで移動を始めていない間は端でも自動スクロールしない", () => {
  const { row, frames, targets } = createDrag({ moved: false });
  assert.equal(frames.length, 0);
  assert.equal(row.scrollLeft, 400);
  assert.equal(targets.length, 0);
});

test("つかみ直して移動開始待ちに戻ると、予約済みのスクロールも止まる", () => {
  const { context, row, frames, targets } = createDrag();
  context.dragMovedRef.current = false;
  frames.shift()();
  assert.equal(row.scrollLeft, 400);
  assert.equal(targets.length, 0);
  assert.equal(frames.length, 0);
});

test("下端で保持し、本の列が指の下から外れて分類枠の余白になってもスクロールが続く", () => {
  const { context, frames, targets, pageScrolls, surface } = createDrag({ x: 200, y: 580, inCategory: true });
  frames.shift()();
  assert.equal(pageScrolls.length, 1);
  surface.inShelf = false;
  for (let index = 0; index < 3; index += 1) {
    assert.equal(frames.length, 1);
    frames.shift()();
  }
  assert.deepEqual(pageScrolls.map((delta) => delta.top), [87, 87, 87, 87]);
  assert.equal(targets.length, 4);
  assert.deepEqual(targets[3], [200, 580, "book-1"]);
  assert.equal(context.window.scrollY, 348);
  context.draggingBookIdRef.current = null;
  frames.shift()();
  assert.equal(frames.length, 0);
});

test("分類枠の余白上からも下方向のスクロールを開始できる", () => {
  const { frames, pageScrolls } = createDrag({ x: 200, y: 580, inShelf: false, inCategory: true });
  frames.shift()();
  assert.equal(pageScrolls[0].top, 87);
  assert.equal(frames.length, 1);
});

test("画面下端に到達してそれ以上動かない場合はスクロールを予約し続けない", () => {
  const { frames, targets } = createDrag({ x: 200, y: 580, inShelf: false, inCategory: true, scrollable: false });
  frames.shift()();
  assert.equal(frames.length, 0);
  assert.equal(targets.length, 0);
});
