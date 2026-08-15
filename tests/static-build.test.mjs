import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("GitHub Pages用の静的アプリを生成する", async () => {
  const [html, app, storage, image, styles, manifest, serviceWorker] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/image.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../dist/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../dist/sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<title>積読ダイヤル \| 表紙から育てる本棚<\/title>/);
  assert.match(html, /(?:src|href)="\/tsundoku-dial\/assets\//);
  assert.match(app, /mediaDevices\.getUserMedia/);
  assert.match(app, /video\.srcObject = stream/);
  assert.match(app, /onCanPlay=\{\(\) => setCameraReady\(true\)\}/);
  assert.doesNotMatch(app, /setTimeout\(\(\) => \{\s*if \(!videoRef\.current\) return/);
  assert.match(app, /editSelectedCover/);
  assert.match(app, /detectBookCrop/);
  assert.match(app, /onPointerDown=\{\(event\) => startCropDrag\(event, "move"\)\}/);
  assert.match(app, /cropHandles\.map/);
  assert.match(app, /minimumCropSize = 8/);
  assert.match(app, /navigator\.share/);
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
  assert.match(app, /requestAnimationFrame\(scrollFrame\)/);
  assert.match(app, /window\.scrollBy\(0, scrollDelta\)/);
  assert.match(app, /closest\("\.classification-tray"\)/);
  assert.match(app, /selectedBookId/);
  assert.match(app, /つかみました。もう一度動かすと並べ替え・分類・削除できます。/);
  assert.match(styles, /\.book-card\.is-selected \{ touch-action: none; \}/);
  assert.doesNotMatch(app, /積んだ本には/);
  assert.match(app, /role="slider"/);
  assert.match(app, /finishDialTurn/);
  assert.match(app, /Math\.round\(pointer\.rotation \/ 72\) \* 72/);
  assert.match(app, /今読んでいる/);
  assert.match(app, /もう一度読みたい/);
  assert.match(app, /持っている/);
  assert.match(app, /data-category-drop=\{category\.id\}/);
  assert.match(app, /classification-tray/);
  assert.match(app, /classificationPanelOpen && books\.length > 0/);
  assert.doesNotMatch(app, /classificationPanelOpen \|\| draggingBookId/);
  assert.match(app, /分類盤を表示する/);
  assert.match(app, /分類盤を閉じる/);
  assert.match(styles, /\.dial-knob/);
  assert.match(styles, /\.classification-tray/);
  assert.match(app, /data-book-id=\{book\.id\}/);
  assert.match(app, /delete-drop-zone/);
  assert.match(app, /saveBookOrder/);
  assert.match(app, /deleteBook/);
  assert.doesNotMatch(app, /type="file"|標準カメラ|fileInputRef|choosePhoto/);
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
  assert.match(serviceWorker, /tsundoku-dial-v13/);
  assert.match(serviceWorker, /caches\.delete/);
});
