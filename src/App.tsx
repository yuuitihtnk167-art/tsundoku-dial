"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { addBook, getBooks, type StoredBook } from "./storage";

type Book = Omit<StoredBook, "cover"> & {
  coverUrl: string;
};

type Crop = { left: number; top: number; right: number; bottom: number };

const initialCrop: Crop = { left: 4, top: 4, right: 96, bottom: 96 };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value.endsWith("Z") ? value : `${value}Z`));
}

async function cropPhoto(file: File, crop: Crop) {
  const image = await createImageBitmap(file);
  const sx = Math.round((crop.left / 100) * image.width);
  const sy = Math.round((crop.top / 100) * image.height);
  const sourceWidth = Math.max(1, Math.round(((crop.right - crop.left) / 100) * image.width));
  const sourceHeight = Math.max(1, Math.round(((crop.bottom - crop.top) / 100) * image.height));
  const scale = Math.min(1, 1400 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像を処理できませんでした。");
  context.drawImage(image, sx, sy, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  image.close();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("画像を保存できませんでした。")), "image/jpeg", 0.88);
  });
}

export function BookLibrary() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [crop, setCrop] = useState<Crop>(initialCrop);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const addDialogRef = useRef<HTMLDialogElement>(null);
  const detailDialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverUrlsRef = useRef<string[]>([]);

  const loadBooks = useCallback(async () => {
    try {
      const storedBooks = await getBooks();
      const nextBooks = storedBooks.map(({ cover, ...book }) => {
        const coverUrl = URL.createObjectURL(cover);
        coverUrlsRef.current.push(coverUrl);
        return { ...book, coverUrl };
      });
      setBooks(nextBooks);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "本棚を読み込めませんでした。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadBooks(), 0);
    return () => window.clearTimeout(timer);
  }, [loadBooks]);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);
  useEffect(() => () => {
    coverUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  useEffect(() => {
    const dialog = detailDialogRef.current;
    if (!dialog) return;
    if (selectedBook && !dialog.open) dialog.showModal();
    if (!selectedBook && dialog.open) dialog.close();
  }, [selectedBook]);

  function openAddDialog() {
    setPhoto(null);
    setPhotoUrl("");
    setCrop(initialCrop);
    setTitle("");
    setNotes("");
    setError("");
    addDialogRef.current?.showModal();
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const nextPhoto = event.target.files?.[0];
    if (!nextPhoto) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhoto(nextPhoto);
    setPhotoUrl(URL.createObjectURL(nextPhoto));
    setCrop(initialCrop);
  }

  function updateCrop(key: keyof Crop, value: number) {
    setCrop((current) => {
      const next = { ...current, [key]: value };
      if (next.right - next.left < 8 || next.bottom - next.top < 8) return current;
      return next;
    });
  }

  async function saveBook(event: FormEvent) {
    event.preventDefault();
    if (!photo) {
      fileInputRef.current?.click();
      return;
    }
    setSaving(true);
    setError("");
    try {
      const cover = await cropPhoto(photo, crop);
      const storedBook = await addBook({
        cover,
        title: title.trim() || "タイトル未設定",
        notes: notes.trim(),
      });
      const { cover: savedCover, ...book } = storedBook;
      const coverUrl = URL.createObjectURL(savedCover);
      coverUrlsRef.current.push(coverUrl);
      setBooks((current) => [{ ...book, coverUrl }, ...current]);
      addDialogRef.current?.close();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="積読ダイヤル ホーム">
          <span className="brand-mark" aria-hidden="true">本</span>
          <span>積読ダイヤル</span>
        </a>
        <button className="add-button" type="button" onClick={openAddDialog}>
          <span aria-hidden="true">＋</span> 表紙を撮る
        </button>
      </header>

      <section className="hero" id="top">
        <p className="eyebrow">MY UNREAD LIBRARY</p>
        <h1>積んだ本には、<br /><em>次の物語</em>が待っている。</h1>
        <p className="lead">気になった一冊を撮るだけ。表紙を並べて、読む楽しみを忘れない本棚へ。</p>
        <div className="summary">
          <span className="summary-number">{books.length}</span>
          <span>冊の積読</span>
          <span className="summary-line" />
        </div>
      </section>

      <section className="shelf" aria-labelledby="shelf-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">BOOKSHELF</p>
            <h2 id="shelf-title">わたしの本棚</h2>
          </div>
          <p>新しく積んだ順</p>
        </div>

        {error && <p className="error-message" role="alert">{error}</p>}
        {loading ? (
          <div className="loading" aria-live="polite">本棚をひらいています…</div>
        ) : books.length === 0 ? (
          <div className="empty-state">
            <div className="empty-books" aria-hidden="true"><i /><i /><i /></div>
            <h3>最初の一冊を積んでみましょう</h3>
            <p>本の表紙を撮ると、ここにあなたの積読が並びます。</p>
            <button type="button" onClick={openAddDialog}>表紙を撮影する</button>
          </div>
        ) : (
          <div className="book-grid">
            {books.map((book, index) => (
              <button className="book-card" type="button" key={book.id} onClick={() => setSelectedBook(book)}>
                <span className="cover-wrap">
                  <img src={book.coverUrl} alt={`${book.title}の表紙`} loading={index > 5 ? "lazy" : "eager"} />
                </span>
                <strong>{book.title}</strong>
                <small>{formatDate(book.createdAt)}</small>
              </button>
            ))}
          </div>
        )}
      </section>

      <dialog className="add-dialog" ref={addDialogRef} onClose={() => setError("")}>
        <form onSubmit={saveBook}>
          <div className="dialog-heading">
            <div><p className="eyebrow">NEW BOOK</p><h2>一冊を積む</h2></div>
            <button className="close-button" type="button" onClick={() => addDialogRef.current?.close()} aria-label="閉じる">×</button>
          </div>

          <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={choosePhoto} />
          {!photoUrl ? (
            <button className="camera-prompt" type="button" onClick={() => fileInputRef.current?.click()}>
              <span className="camera-shape" aria-hidden="true" />
              <strong>本の表紙を撮影</strong>
              <small>本が画面いっぱいに入るように撮ってください</small>
            </button>
          ) : (
            <div className="crop-area">
              <p className="crop-help"><span>1</span> 白い枠を本の表紙に合わせてください</p>
              <div className="crop-stage">
                <img src={photoUrl} alt="撮影した本の切り抜きプレビュー" />
                <div className="crop-box" style={{ left: `${crop.left}%`, top: `${crop.top}%`, right: `${100 - crop.right}%`, bottom: `${100 - crop.bottom}%` }} />
              </div>
              <div className="crop-controls">
                <label>左 <input type="range" min="0" max="88" value={crop.left} onChange={(e) => updateCrop("left", Number(e.target.value))} /></label>
                <label>右 <input type="range" min="12" max="100" value={crop.right} onChange={(e) => updateCrop("right", Number(e.target.value))} /></label>
                <label>上 <input type="range" min="0" max="88" value={crop.top} onChange={(e) => updateCrop("top", Number(e.target.value))} /></label>
                <label>下 <input type="range" min="12" max="100" value={crop.bottom} onChange={(e) => updateCrop("bottom", Number(e.target.value))} /></label>
              </div>
              <button className="retake" type="button" onClick={() => fileInputRef.current?.click()}>撮り直す</button>
            </div>
          )}

          <div className="fields">
            <label><span>タイトル</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="あとからでも入力できます" maxLength={160} /></label>
            <label><span>メモ <small>任意</small></span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="この本を選んだ理由など" maxLength={1000} rows={3} /></label>
          </div>
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="save-button" type="submit" disabled={saving}>{saving ? "保存しています…" : "この本を積む"}</button>
        </form>
      </dialog>

      <dialog
        className="detail-dialog"
        ref={detailDialogRef}
        onClose={() => setSelectedBook(null)}
      >
        {selectedBook && (
          <section className="detail-card" role="dialog" aria-modal="true" aria-labelledby="book-detail-title">
            <button className="close-button" type="button" onClick={() => setSelectedBook(null)} aria-label="詳細を閉じる">×</button>
            <img src={selectedBook.coverUrl} alt={`${selectedBook.title}の表紙`} />
            <div className="detail-copy">
              <p className="eyebrow">BOOK DETAIL</p>
              <h2 id="book-detail-title">{selectedBook.title}</h2>
              <dl><div><dt>積んだ日</dt><dd>{formatDate(selectedBook.createdAt)}</dd></div></dl>
              {selectedBook.notes && <p className="book-notes">{selectedBook.notes}</p>}
              {!selectedBook.isbn && <p className="barcode-note">バーコードからの書籍情報取得は、次のアップデートで追加予定です。</p>}
            </div>
          </section>
        )}
      </dialog>
    </main>
  );
}
