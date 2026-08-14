"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  cropPhoto,
  detectBookCrop,
  fullCrop,
  initialCrop,
  normalizePhoto,
  type Crop,
} from "./image";
import { addBook, getBooks, updateBook, type StoredBook } from "./storage";

type Book = StoredBook & {
  coverUrl: string;
};

const lockedViewport = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no";
const detailViewport = "width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value.endsWith("Z") ? value : `${value}Z`));
}

export function BookLibrary() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoAspectRatio, setPhotoAspectRatio] = useState(2 / 3);
  const [crop, setCrop] = useState<Crop>(initialCrop);
  const [detecting, setDetecting] = useState(false);
  const [cropMessage, setCropMessage] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const addDialogRef = useRef<HTMLDialogElement>(null);
  const detailDialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const coverUrlsRef = useRef<string[]>([]);

  const loadBooks = useCallback(async () => {
    try {
      const storedBooks = await getBooks();
      const nextBooks = storedBooks.map((book) => {
        const coverUrl = URL.createObjectURL(book.cover);
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
  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadBooks(), 0);
    return () => window.clearTimeout(timer);
  }, [loadBooks]);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);
  useEffect(() => () => {
    coverUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  useEffect(() => stopCamera, [stopCamera]);
  useEffect(() => {
    const dialog = detailDialogRef.current;
    if (!dialog) return;
    if (selectedBook && !dialog.open) dialog.showModal();
    if (!selectedBook && dialog.open) dialog.close();
  }, [selectedBook]);
  useEffect(() => {
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!viewport) return;

    viewport.content = selectedBook ? detailViewport : lockedViewport;
    return () => {
      viewport.content = lockedViewport;
    };
  }, [selectedBook]);

  function openAddDialog() {
    stopCamera();
    setEditingBookId(null);
    setPhoto(null);
    setPhotoUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
    setCrop(initialCrop);
    setPhotoAspectRatio(2 / 3);
    setCropMessage("");
    setTitle("");
    setNotes("");
    setError("");
    addDialogRef.current?.showModal();
  }

  function closeAddDialog() {
    stopCamera();
    addDialogRef.current?.close();
  }

  async function applyPhoto(source: Blob) {
    setDetecting(true);
    setError("");
    stopCamera();
    try {
      const normalized = await normalizePhoto(source);
      const result = await detectBookCrop(normalized);
      setPhoto(normalized);
      setPhotoUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(normalized);
      });
      setCrop(result.crop);
      setCropMessage(
        result.detected
          ? "表紙を自動検出しました。必要ならスライダーで微調整できます。"
          : "表紙を自動検出できませんでした。白い枠を微調整してください。",
      );
    } catch (photoError) {
      setError(
        photoError instanceof Error
          ? photoError.message
          : "撮影した画像を処理できませんでした。",
      );
    } finally {
      setDetecting(false);
    }
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const nextPhoto = event.target.files?.[0];
    if (!nextPhoto) return;
    void applyPhoto(nextPhoto);
    event.target.value = "";
  }

  async function startCamera() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("この端末ではアプリ内カメラを利用できません。写真を選択してください。");
      return;
    }

    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      cameraStreamRef.current = stream;
      setCameraActive(true);
      window.setTimeout(() => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        void videoRef.current.play();
      }, 0);
    } catch {
      stopCamera();
      setError("カメラを開始できませんでした。権限を確認するか、写真を選択してください。");
    }
  }

  async function captureCameraPhoto() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setError("カメラの準備ができていません。少し待ってから撮影してください。");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("カメラ画像を処理できませんでした。");
      return;
    }
    context.drawImage(video, 0, 0);
    const captured = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });
    if (!captured) {
      setError("写真を作成できませんでした。");
      return;
    }
    await applyPhoto(captured);
  }

  function editSelectedCover() {
    if (!selectedBook) return;
    const original = selectedBook.original ?? selectedBook.cover;
    setEditingBookId(selectedBook.id);
    setPhoto(original);
    setPhotoUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(original);
    });
    setCrop(selectedBook.crop ?? fullCrop);
    setCropMessage(
      selectedBook.original
        ? "保存時の元画像から表紙を微調整できます。"
        : "この本には元画像がないため、現在の表紙の範囲内で調整できます。",
    );
    setTitle(selectedBook.title);
    setNotes(selectedBook.notes);
    setError("");
    detailDialogRef.current?.close();
    setSelectedBook(null);
    addDialogRef.current?.showModal();
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
      const values = {
        cover,
        original: photo,
        crop,
        title: title.trim() || "タイトル未設定",
        notes: notes.trim(),
      };
      const storedBook = editingBookId
        ? await updateBook({ id: editingBookId, ...values })
        : await addBook(values);
      const coverUrl = URL.createObjectURL(storedBook.cover);
      coverUrlsRef.current.push(coverUrl);
      const nextBook = { ...storedBook, coverUrl };
      setBooks((current) => {
        if (!editingBookId) return [nextBook, ...current];
        return current.map((book) => {
          if (book.id !== editingBookId) return book;
          URL.revokeObjectURL(book.coverUrl);
          return nextBook;
        });
      });
      closeAddDialog();
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

      <dialog
        className="add-dialog"
        ref={addDialogRef}
        onClose={() => {
          stopCamera();
          setError("");
        }}
      >
        <form onSubmit={saveBook}>
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">{editingBookId ? "EDIT COVER" : "NEW BOOK"}</p>
              <h2>{editingBookId ? "表紙を微調整" : "一冊を積む"}</h2>
            </div>
            <button className="close-button" type="button" onClick={closeAddDialog} aria-label="閉じる">×</button>
          </div>

          <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={choosePhoto} />
          {!photoUrl ? (
            cameraActive ? (
              <div className="camera-panel">
                <p className="crop-help"><span>1</span> 線に合わせて本をまっすぐ置いてください</p>
                <div className="camera-preview">
                  <video ref={videoRef} muted playsInline aria-label="カメラ映像" />
                  <div className="camera-guide" aria-hidden="true">
                    <i /><i /><i /><i />
                  </div>
                </div>
                <button className="shutter-button" type="button" onClick={() => void captureCameraPhoto()}>
                  撮影する
                </button>
                <button className="retake" type="button" onClick={stopCamera}>カメラを閉じる</button>
              </div>
            ) : (
              <div className="camera-actions">
                <button className="camera-prompt" type="button" onClick={() => void startCamera()} disabled={detecting}>
                  <span className="camera-shape" aria-hidden="true" />
                  <strong>ガイド付きで表紙を撮影</strong>
                  <small>縦横の線に合わせて、まっすぐ撮影できます</small>
                </button>
                <button className="file-choice" type="button" onClick={() => fileInputRef.current?.click()} disabled={detecting}>
                  標準カメラを使う
                </button>
                {detecting && <p className="detecting-message" aria-live="polite">表紙の余白を検出しています…</p>}
              </div>
            )
          ) : (
            <div className="crop-area">
              <p className="crop-help"><span>2</span> 自動検出した白い枠を確認してください</p>
              <div className="crop-stage" style={{ aspectRatio: photoAspectRatio }}>
                <img
                  src={photoUrl}
                  alt="撮影した本の切り抜きプレビュー"
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    setPhotoAspectRatio(image.naturalWidth / image.naturalHeight);
                  }}
                />
                <div className="crop-box" style={{ left: `${crop.left}%`, top: `${crop.top}%`, right: `${100 - crop.right}%`, bottom: `${100 - crop.bottom}%` }} />
              </div>
              {cropMessage && <p className="crop-message" aria-live="polite">{cropMessage}</p>}
              <div className="crop-controls">
                <label>左 <input type="range" min="0" max="88" value={crop.left} onChange={(e) => updateCrop("left", Number(e.target.value))} /></label>
                <label>右 <input type="range" min="12" max="100" value={crop.right} onChange={(e) => updateCrop("right", Number(e.target.value))} /></label>
                <label>上 <input type="range" min="0" max="88" value={crop.top} onChange={(e) => updateCrop("top", Number(e.target.value))} /></label>
                <label>下 <input type="range" min="12" max="100" value={crop.bottom} onChange={(e) => updateCrop("bottom", Number(e.target.value))} /></label>
              </div>
              <div className="retake-actions">
                <button className="retake" type="button" onClick={() => {
                  setPhoto(null);
                  setPhotoUrl((current) => {
                    if (current) URL.revokeObjectURL(current);
                    return "";
                  });
                  setCropMessage("");
                  void startCamera();
                }}>ガイド付きで撮り直す</button>
                <button className="retake" type="button" onClick={() => fileInputRef.current?.click()}>標準カメラで撮り直す</button>
              </div>
            </div>
          )}

          <div className="fields">
            <label><span>タイトル</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="あとからでも入力できます" maxLength={160} /></label>
            <label><span>メモ <small>任意</small></span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="この本を選んだ理由など" maxLength={1000} rows={3} /></label>
          </div>
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="save-button" type="submit" disabled={saving || detecting}>
            {saving ? "保存しています…" : editingBookId ? "表紙を更新する" : "この本を積む"}
          </button>
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
              <button className="edit-cover-button" type="button" onClick={editSelectedCover}>
                表紙を微調整
              </button>
              {!selectedBook.isbn && <p className="barcode-note">バーコードからの書籍情報取得は、次のアップデートで追加予定です。</p>}
            </div>
          </section>
        )}
      </dialog>
    </main>
  );
}
