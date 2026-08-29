import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("GitHub Pages用の静的アプリを生成する", async () => {
  const [html, app, storage, backup, image, styles, manifest, serviceWorker] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/backup.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/image.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../dist/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../dist/sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<title>積読ダイヤル \| 表紙から育てる本棚<\/title>/);
  assert.match(html, /(?:src|href)="\/tsundoku-dial\/assets\//);
  assert.match(app, /mediaDevices\.getUserMedia/);
  assert.doesNotMatch(app, /一冊を積む/);
  assert.match(app, /editingBookId && <h2>修正<\/h2>/);
  assert.match(app, /video\.srcObject = stream/);
  assert.match(app, /onCanPlay=\{\(\) => setCameraReady\(true\)\}/);
  assert.doesNotMatch(app, /setTimeout\(\(\) => \{\s*if \(!videoRef\.current\) return/);
  assert.match(app, /editSelectedCover/);
  assert.match(app, /detectBookCrop/);
  assert.match(app, /onPointerDown=\{\(event\) => startCropDrag\(event, "move"\)\}/);
  assert.match(app, /cropHandles\.map/);
  assert.match(app, /minimumCropSize = 8/);
  assert.match(app, /navigator\.share/);
  assert.match(app, /createTitleAnalysisPrompt/);
  assert.match(app, /正式タイトル・本の要約・表紙画像/);
  assert.match(app, /navigator\.clipboard\.read\(\)/);
  assert.match(app, /表紙画像を貼り付ける/);
  assert.match(app, /navigator\.canShare/);
  assert.match(app, /new File\(/);
  assert.match(app, /共有先でChatGPTを選ぶ/);
  assert.match(app, /navigator\.clipboard\.writeText\(bookAnalysisPrompt\)/);
  assert.match(app, /分析用の文章をコピー/);
  assert.match(app, /ChatGPTに貼り付けてください。/);
  assert.match(app, /出版社、公式書籍ページ、著者情報などを優先/);
  assert.match(app, /200～300文字程度を目安にする/);
  assert.match(app, /text: bookAnalysisPrompt/);
  assert.match(app, /}, 300\)/);
  assert.match(app, /distance > 18/);
  assert.match(app, /getBookDragScrollDelta/);
  assert.match(app, /bookDragMaximumScrollSpeed = 112/);
  assert.match(app, /requestAnimationFrame\(scrollFrame\)/);
  assert.match(app, /window\.innerHeight,\s+window\.innerHeight/);
  assert.match(app, /window\.scrollBy\(\{ top: scrollDelta, behavior: "instant" \}\)/);
  assert.match(app, /closest\("\[data-book-drop\]"\)/);
  assert.doesNotMatch(app, /className=\{photo \? "has-photo" : undefined\}/);
  assert.doesNotMatch(styles, /\.add-dialog form\.has-photo/);
  assert.match(app, /className="crop-scroll-area"/);
  assert.match(app, /--crop-stage-mobile-width/);
  assert.match(styles, /\.crop-scroll-area \{ min-height: 58px; padding-top: 5px; touch-action: pan-y; \}/);
  assert.match(styles, /\.crop-stage \{ width: min\(100%, var\(--crop-stage-mobile-width\)\); margin-inline: auto; \}/);
  assert.match(app, /selectedBookId/);
  assert.match(app, /つかみました。もう一度動かすと並べ替え・分類・削除できます。/);
  assert.match(styles, /\.book-card\.is-selected \{ touch-action: none; \}/);
  assert.doesNotMatch(app, /積んだ本には/);
  assert.doesNotMatch(app, /role="slider"/);
  assert.doesNotMatch(app, /finishDialTurn/);
  assert.doesNotMatch(app, /dial-channel-window/);
  assert.match(app, /className="category-zone-panel" data-book-drop-container/);
  assert.match(app, /onClick=\{\(\) => selectCategory\(category\.id\)\}/);
  assert.match(app, /className=\{deleteDropActive \? "category-delete-zone is-drop-active"/);
  assert.match(app, /今読んでいる/);
  assert.match(app, /もう一度読みたい/);
  assert.match(app, /持っている/);
  assert.match(app, /data-category-drop=\{category\.id\}/);
  assert.match(app, /data-book-drop="category"/);
  assert.match(app, /data-book-drop="delete"/);
  assert.match(app, /function resolveBookDropTarget/);
  assert.match(app, /dropContainer\.querySelectorAll<HTMLElement>\("\[data-book-drop\]"\)/);
  assert.match(app, /document\.querySelector<HTMLElement>\("\.book-drag-preview"\)/);
  assert.match(app, /document\.querySelectorAll<HTMLElement>\("\[data-book-drop\]"\)/);
  assert.match(app, /overlapArea\(\s+draggedCoverBounds,/);
  assert.match(app, /resolveCompletedDropTarget/);
  assert.match(app, /isAvailableCategoryDrop/);
  assert.match(app, /bookDropTargetRef\.current/);
  assert.match(app, /window\.addEventListener\("pointerup", handlePointerUp\)/);
  assert.match(app, /window\.addEventListener\("pointercancel", handlePointerCancel\)/);
  assert.match(app, /source\.addEventListener\("lostpointercapture", handleLostPointerCapture\)/);
  assert.match(app, /bookPointerStartRef\.current = null;\s+bookDragListenersCleanupRef\.current\?\.\(\)/);
  assert.match(app, /pointerStart\.pointerType === "mouse" && distance > 6/);
  assert.match(app, /onDragStart=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(app, /draggable=\{false\}/);
  assert.doesNotMatch(app, /classification-tray/);
  assert.doesNotMatch(app, /classificationPanelOpen/);
  assert.match(app, /id="category-panel-title">本の分類/);
  assert.match(app, /タップして表示。本をドラッグして分類・削除できます/);
  assert.doesNotMatch(styles, /\.dial-knob/);
  assert.doesNotMatch(styles, /\.dial-channel-window/);
  assert.doesNotMatch(styles, /\.classification-tray/);
  assert.match(styles, /\.category-zone-panel/);
  assert.match(styles, /height: clamp\(420px, 70svh, 560px\)/);
  assert.match(styles, /grid-template-rows: repeat\(3, 1fr\)/);
  assert.match(styles, /\.category-delete-zone/);
  assert.match(styles, /\.shelf-trash-target/);
  assert.match(app, /data-book-id=\{book\.id\}/);
  assert.match(app, /shelf-trash-target/);
  assert.match(app, /saveBookOrder/);
  assert.match(app, /deleteBook/);
  assert.match(app, /「\$\{book\.title\}」を削除しますか？/);
  assert.match(app, /この操作は取り消せません/);
  assert.match(app, /削除をキャンセルしました/);
  assert.doesNotMatch(app, /accept="image\/\*"|標準カメラ|fileInputRef|choosePhoto/);
  assert.match(app, /className="settings-button"/);
  assert.match(styles, /\.add-button, \.settings-button \{ border: 2px solid var\(--brass\)/);
  assert.match(styles, /\.add-button:active, \.settings-button:active/);
  assert.match(app, /type BookViewMode = "dial" \| "shelf"/);
  assert.match(app, /tsundoku-dial-book-view-mode/);
  assert.match(app, /shelfCategoryOrder/);
  assert.match(app, /data-category-row=\{category\}/);
  assert.match(app, /bookViewMode === "shelf" &&/);
  assert.match(app, /preventScrollWhileDragging/);
  assert.match(app, /if \(draggingBookIdRef\.current\) event\.preventDefault\(\)/);
  assert.doesNotMatch(app, /if \(classificationPanelOpen \|\| draggingBookIdRef\.current\) event\.preventDefault\(\)/);
  assert.doesNotMatch(app, /classificationPanelOpen/);
  assert.doesNotMatch(app, /document\.body\.style\.position = "fixed"/);
  assert.match(app, /getBookDragHorizontalScrollDelta/);
  assert.match(styles, /\.bookshelf-row-scroll/);
  assert.match(styles, /touch-action: pan-x pan-y/);
  assert.match(app, /完全バックアップを作成/);
  assert.match(app, /accept="\.json,application\/json"/);
  assert.match(app, /createCompleteBackup/);
  assert.match(app, /parseCompleteBackup/);
  assert.match(app, /replaceBooks/);
  assert.match(backup, /tsundoku-dial-backup/);
  assert.match(backup, /SHA-256/);
  assert.match(backup, /同じ書籍IDが重複しています/);
  assert.match(storage, /transaction\.oncomplete/);
  assert.match(storage, /store\.clear\(\)/);
  assert.doesNotMatch(app, /type="range"|crop-controls|updateCrop/);
  assert.doesNotMatch(app, /fetch\(|\/api\//);
  assert.match(app, /maximum-scale=5\.0, user-scalable=yes/);
  assert.match(storage, /indexedDB\.open/);
  assert.match(storage, /createObjectStore\(BOOK_STORE/);
  assert.match(storage, /original\?: Blob/);
  assert.match(storage, /export async function updateBook/);
  assert.match(storage, /sortOrder\?: number/);
  assert.match(storage, /category\?: BookCategory/);
  assert.match(storage, /category: "unclassified"/);
  assert.match(storage, /export async function updateBookCategory/);
  assert.match(storage, /export async function saveBookOrder/);
  assert.match(storage, /export async function deleteBook/);
  assert.match(image, /function detectBounds/);
  assert.match(image, /normalizePhoto/);
  assert.match(html, /rel="manifest" href="\/tsundoku-dial\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.doesNotMatch(html, /\/src\/main\.tsx/);
  assert.match(html, /maximum-scale=1\.0, user-scalable=no/);

  const parsedManifest = JSON.parse(manifest);
  assert.equal(parsedManifest.display, "standalone");
  assert.equal(parsedManifest.start_url, "/tsundoku-dial/");
  assert.deepEqual(
    parsedManifest.icons.map(({ sizes }) => sizes),
    ["192x192", "512x512"],
  );
  assert.match(serviceWorker, /tsundoku-dial-v31/);
  assert.match(serviceWorker, /caches\.delete/);
});
