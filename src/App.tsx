"use client";

import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  cropPhoto,
  detectBookCrop,
  fullCrop,
  initialCrop,
  normalizePhoto,
  type Crop,
} from "./image";
import {
  addBook,
  deleteBook,
  getBooks,
  saveBookOrder,
  updateBook,
  type StoredBook,
} from "./storage";

type Book = StoredBook & {
  coverUrl: string;
};

type CropHandle = "move" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

type CropDrag = {
  pointerId: number;
  handle: CropHandle;
  startX: number;
  startY: number;
  startCrop: Crop;
  stageWidth: number;
  stageHeight: number;
};

type PreparedShare = {
  file: File;
  source: Blob;
  cropKey: string;
};

type BookPointerStart = {
  pointerId: number;
  bookId: string;
  x: number;
  y: number;
};

const cropHandles: Array<{ handle: CropHandle; label: string }> = [
  { handle: "nw", label: "左上を調整" },
  { handle: "n", label: "上辺を調整" },
  { handle: "ne", label: "右上を調整" },
  { handle: "e", label: "右辺を調整" },
  { handle: "se", label: "右下を調整" },
  { handle: "s", label: "下辺を調整" },
  { handle: "sw", label: "左下を調整" },
  { handle: "w", label: "左辺を調整" },
];

const bookAnalysisPrompt = [
  "添付・共有した本の画像を確認し、この本について調べて、読書記録アプリに保存するための文章を作成してください。",
  "",
  "【調査】",
  "",
  "- 表紙から書名・著者名・出版社などを読み取ってください。",
  "- 書名を特定したら、Webで信頼できる情報を調べて内容を確認してください。",
  "- 出版社、公式書籍ページ、著者情報などを優先してください。",
  "- 画像だけでは確認できない内容を推測で書かないでください。",
  "- 確認できない情報は「確認できない」としてください。",
  "",
  "【出力形式】",
  "",
  "最初に、本のタイトルだけを独立したコードブロックで出力してください。",
  "",
  "```text",
  "本の正式タイトル",
  "```",
  "",
  "その後、読書記録用の本文を別のコードブロックで出力してください。",
  "",
  "本文には次の内容を、簡潔で分かりやすい文章にまとめてください。",
  "",
  "- どんな本なのか",
  "- 主に何を学べる本なのか",
  "- 主な内容・テーマ",
  "- どんな人に向いている本なのか",
  "- この本の特徴",
  "",
  "文章は、あとから読書記録を見返したときに「どんな本だったか」がすぐ分かる程度の長さにしてください。",
  "長すぎる説明や細かすぎる目次紹介は不要です。",
  "",
  "```text",
  "読書記録用本文",
  "```",
  "",
  "【文章の方針】",
  "",
  "- 事実に基づいて書く",
  "- 宣伝文句をそのまま使わない",
  "- 難しい専門用語はできるだけ分かりやすく言い換える",
  "- 200～300文字程度を目安にする",
  "- 感想や評価は勝手に付け加えない",
  "- ISBN、価格、発売日などは、内容理解に必要でなければ本文には入れない",
].join("\n");

const minimumCropSize = 8;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

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
  const [cameraReady, setCameraReady] = useState(false);
  const [preparedShare, setPreparedShare] = useState<PreparedShare | null>(null);
  const [sharing, setSharing] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [draggingBookId, setDraggingBookId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [deleteDropActive, setDeleteDropActive] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const addDialogRef = useRef<HTMLDialogElement>(null);
  const detailDialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cropDragRef = useRef<CropDrag | null>(null);
  const booksRef = useRef<Book[]>([]);
  const longPressTimerRef = useRef<number | null>(null);
  const bookPointerStartRef = useRef<BookPointerStart | null>(null);
  const draggingBookIdRef = useRef<string | null>(null);
  const deleteDropActiveRef = useRef(false);
  const lastReorderTargetRef = useRef<string | null>(null);
  const suppressBookClickRef = useRef(false);
  const coverUrlsRef = useRef<string[]>([]);
  const cropKey = [crop.left, crop.top, crop.right, crop.bottom].join(":");
  const shareFile =
    preparedShare?.source === photo && preparedShare.cropKey === cropKey
      ? preparedShare.file
      : null;

  const loadBooks = useCallback(async () => {
    try {
      const storedBooks = await getBooks();
      const nextBooks = storedBooks.map((book) => {
        const coverUrl = URL.createObjectURL(book.cover);
        coverUrlsRef.current.push(coverUrl);
        return { ...book, coverUrl };
      });
      booksRef.current = nextBooks;
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
    setCameraReady(false);
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
  useEffect(() => () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
    }
  }, []);
  useEffect(() => stopCamera, [stopCamera]);
  useEffect(() => {
    if (!cameraActive) return;
    const video = videoRef.current;
    const stream = cameraStreamRef.current;
    if (!video || !stream) {
      setError("カメラ映像を表示できませんでした。カメラを開き直してください。");
      return;
    }

    let cancelled = false;
    video.srcObject = stream;
    const startPlayback = async () => {
      try {
        await video.play();
      } catch {
        if (cancelled) return;
        setError("カメラ映像を再生できませんでした。カメラを開き直してください。");
        stopCamera();
      }
    };

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      void startPlayback();
    } else {
      video.addEventListener("loadedmetadata", startPlayback, { once: true });
    }

    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", startPlayback);
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [cameraActive, stopCamera]);
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
  useEffect(() => {
    let cancelled = false;
    if (!photo) return;

    const timer = window.setTimeout(() => {
      void cropPhoto(photo, crop)
        .then((cover) => {
          if (cancelled) return;
          setPreparedShare({
            file: new File(
              [cover],
              "book-cover.jpg",
              { type: cover.type || "image/jpeg" },
            ),
            source: photo,
            cropKey,
          });
        })
        .catch(() => {
          if (!cancelled) setError("共有用の画像を準備できませんでした。");
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [crop, cropKey, photo]);

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
    setPromptCopied(false);
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
          ? "表紙を自動検出しました。必要なら白い枠を直接動かしてください。"
          : "表紙を自動検出できませんでした。白い枠を直接動かして調整してください。",
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

  async function startCamera() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("この端末またはブラウザでは、ガイド付きカメラを利用できません。");
      return;
    }

    try {
      stopCamera();
      setCameraReady(false);
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
    } catch {
      stopCamera();
      setError("カメラを開始できませんでした。ブラウザのカメラ権限を確認してください。");
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
    setPromptCopied(false);
    setTitle(selectedBook.title);
    setNotes(selectedBook.notes);
    setError("");
    detailDialogRef.current?.close();
    setSelectedBook(null);
    addDialogRef.current?.showModal();
  }

  function startCropDrag(event: ReactPointerEvent<HTMLButtonElement>, handle: CropHandle) {
    const stage = event.currentTarget.closest<HTMLElement>(".crop-stage");
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    cropDragRef.current = {
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startCrop: crop,
      stageWidth: bounds.width,
      stageHeight: bounds.height,
    };
  }

  function dragCrop(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();

    const deltaX = ((event.clientX - drag.startX) / drag.stageWidth) * 100;
    const deltaY = ((event.clientY - drag.startY) / drag.stageHeight) * 100;
    const next = { ...drag.startCrop };

    if (drag.handle === "move") {
      const width = drag.startCrop.right - drag.startCrop.left;
      const height = drag.startCrop.bottom - drag.startCrop.top;
      next.left = clamp(drag.startCrop.left + deltaX, 0, 100 - width);
      next.right = next.left + width;
      next.top = clamp(drag.startCrop.top + deltaY, 0, 100 - height);
      next.bottom = next.top + height;
    } else {
      if (drag.handle.includes("w")) {
        next.left = clamp(drag.startCrop.left + deltaX, 0, drag.startCrop.right - minimumCropSize);
      }
      if (drag.handle.includes("e")) {
        next.right = clamp(drag.startCrop.right + deltaX, drag.startCrop.left + minimumCropSize, 100);
      }
      if (drag.handle.includes("n")) {
        next.top = clamp(drag.startCrop.top + deltaY, 0, drag.startCrop.bottom - minimumCropSize);
      }
      if (drag.handle.includes("s")) {
        next.bottom = clamp(drag.startCrop.bottom + deltaY, drag.startCrop.top + minimumCropSize, 100);
      }
    }

    setCrop(next);
  }

  function finishCropDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (cropDragRef.current?.pointerId !== event.pointerId) return;
    cropDragRef.current = null;
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  function setDeleteTarget(active: boolean) {
    if (deleteDropActiveRef.current === active) return;
    deleteDropActiveRef.current = active;
    setDeleteDropActive(active);
  }

  function startBookPress(event: ReactPointerEvent<HTMLButtonElement>, bookId: string) {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    clearLongPressTimer();
    event.currentTarget.setPointerCapture(event.pointerId);
    bookPointerStartRef.current = {
      pointerId: event.pointerId,
      bookId,
      x: event.clientX,
      y: event.clientY,
    };
    longPressTimerRef.current = window.setTimeout(() => {
      draggingBookIdRef.current = bookId;
      lastReorderTargetRef.current = bookId;
      suppressBookClickRef.current = true;
      setDraggingBookId(bookId);
      setDragPosition({ x: event.clientX, y: event.clientY });
      navigator.vibrate?.(25);
    }, 450);
  }

  function moveBook(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointerStart = bookPointerStartRef.current;
    if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - pointerStart.x,
      event.clientY - pointerStart.y,
    );
    if (!draggingBookIdRef.current && distance > 10) {
      clearLongPressTimer();
      return;
    }

    const draggedId = draggingBookIdRef.current;
    if (!draggedId) return;
    event.preventDefault();
    setDragPosition({ x: event.clientX, y: event.clientY });

    const element = document.elementFromPoint(
      event.clientX,
      event.clientY,
    ) as HTMLElement | null;
    const overDelete = Boolean(element?.closest(".delete-drop-zone"));
    setDeleteTarget(overDelete);
    if (overDelete) return;

    const targetId = element?.closest<HTMLElement>("[data-book-id]")?.dataset.bookId;
    if (!targetId || targetId === draggedId) {
      lastReorderTargetRef.current = null;
      return;
    }
    if (lastReorderTargetRef.current === targetId) return;
    lastReorderTargetRef.current = targetId;

    setBooks((current) => {
      const draggedIndex = current.findIndex((book) => book.id === draggedId);
      const targetIndex = current.findIndex((book) => book.id === targetId);
      if (draggedIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [draggedBook] = next.splice(draggedIndex, 1);
      next.splice(targetIndex, 0, draggedBook);
      booksRef.current = next;
      return next;
    });
  }

  async function removeDraggedBook(bookId: string) {
    const book = booksRef.current.find((item) => item.id === bookId);
    try {
      await deleteBook(bookId);
      if (book) URL.revokeObjectURL(book.coverUrl);
      const next = booksRef.current.filter((item) => item.id !== bookId);
      booksRef.current = next;
      setBooks(next);
      setError("");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "本を削除できませんでした。");
    }
  }

  async function persistCurrentBookOrder() {
    try {
      await saveBookOrder(booksRef.current.map((book) => book.id));
      setError("");
    } catch (orderError) {
      setError(orderError instanceof Error ? orderError.message : "並び順を保存できませんでした。");
    }
  }

  function finishBookPress(
    event: ReactPointerEvent<HTMLButtonElement>,
    allowDelete: boolean,
  ) {
    const pointerStart = bookPointerStartRef.current;
    if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;
    clearLongPressTimer();
    bookPointerStartRef.current = null;

    const draggedId = draggingBookIdRef.current;
    if (!draggedId) return;
    const shouldDelete = allowDelete && deleteDropActiveRef.current;
    draggingBookIdRef.current = null;
    lastReorderTargetRef.current = null;
    setDeleteTarget(false);
    setDraggingBookId(null);
    setDragPosition(null);
    window.setTimeout(() => {
      suppressBookClickRef.current = false;
    }, 0);

    if (shouldDelete) {
      void removeDraggedBook(draggedId);
    } else {
      void persistCurrentBookOrder();
    }
  }

  function openBook(book: Book) {
    if (suppressBookClickRef.current) return;
    setSelectedBook(book);
  }

  async function copyAnalysisPrompt() {
    if (!navigator.clipboard?.writeText) {
      setError("この端末またはブラウザは文章のコピーに対応していません。");
      return;
    }
    try {
      await navigator.clipboard.writeText(bookAnalysisPrompt);
      setPromptCopied(true);
      setError("");
    } catch {
      setError("分析用の文章をコピーできませんでした。もう一度お試しください。");
    }
  }

  async function shareCover() {
    if (!shareFile) {
      setError("共有する画像を準備しています。少し待ってからもう一度お試しください。");
      return;
    }
    if (!navigator.share || (navigator.canShare && !navigator.canShare({ files: [shareFile] }))) {
      setError("この端末またはブラウザは画像の共有に対応していません。");
      return;
    }

    setSharing(true);
    setError("");
    try {
      await navigator.share({
        files: [shareFile],
        title: "本の表紙",
        text: bookAnalysisPrompt,
      });
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      setError("画像を共有できませんでした。もう一度お試しください。");
    } finally {
      setSharing(false);
    }
  }

  async function saveBook(event: FormEvent) {
    event.preventDefault();
    if (!photo) {
      setError("表紙を撮影してください。");
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
        const next = !editingBookId
          ? [nextBook, ...current]
          : current.map((book) => {
            if (book.id !== editingBookId) return book;
            URL.revokeObjectURL(book.coverUrl);
            return nextBook;
          });
        booksRef.current = next;
        return next;
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
          <p>長押しで並べ替え・削除</p>
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
              <button
                className={book.id === draggingBookId ? "book-card is-dragging" : "book-card"}
                type="button"
                key={book.id}
                data-book-id={book.id}
                aria-pressed={book.id === draggingBookId}
                onClick={() => openBook(book)}
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={(event) => startBookPress(event, book.id)}
                onPointerMove={moveBook}
                onPointerUp={(event) => finishBookPress(event, true)}
                onPointerCancel={(event) => finishBookPress(event, false)}
              >
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

      {draggingBookId && dragPosition && (() => {
        const draggedBook = books.find((book) => book.id === draggingBookId);
        if (!draggedBook) return null;
        return (
          <div
            className="book-drag-preview"
            style={{ left: dragPosition.x, top: dragPosition.y }}
            aria-hidden="true"
          >
            <img src={draggedBook.coverUrl} alt="" />
            <strong>{draggedBook.title}</strong>
          </div>
        );
      })()}
      {draggingBookId && (
        <div
          className={deleteDropActive ? "delete-drop-zone is-active" : "delete-drop-zone"}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true">×</span>
          {deleteDropActive ? "ここで離すと削除します" : "ここへ移動して削除"}
        </div>
      )}

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

          {!photoUrl ? (
            cameraActive ? (
              <div className="camera-panel">
                <p className="crop-help"><span>1</span> 線に合わせて本をまっすぐ置いてください</p>
                <div className="camera-preview">
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    aria-label="カメラ映像"
                    onCanPlay={() => setCameraReady(true)}
                  />
                  <div className="camera-guide" aria-hidden="true">
                    <i /><i /><i /><i />
                  </div>
                </div>
                <button
                  className="shutter-button"
                  type="button"
                  onClick={() => void captureCameraPhoto()}
                  disabled={!cameraReady}
                >
                  {cameraReady ? "撮影する" : "カメラ準備中…"}
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
                {detecting && <p className="detecting-message" aria-live="polite">表紙の余白を検出しています…</p>}
              </div>
            )
          ) : (
            <div className="crop-area">
              <p className="crop-help"><span>2</span> 白い枠を指で動かして切り取り範囲を調整してください</p>
              <div
                className="crop-stage"
                style={{ aspectRatio: photoAspectRatio }}
                onPointerMove={dragCrop}
                onPointerUp={finishCropDrag}
                onPointerCancel={finishCropDrag}
              >
                <img
                  src={photoUrl}
                  alt="撮影した本の切り抜きプレビュー"
                  draggable={false}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    setPhotoAspectRatio(image.naturalWidth / image.naturalHeight);
                  }}
                />
                <div
                  className="crop-box"
                  style={{ left: `${crop.left}%`, top: `${crop.top}%`, right: `${100 - crop.right}%`, bottom: `${100 - crop.bottom}%` }}
                >
                  <button
                    className="crop-move"
                    type="button"
                    aria-label="切り取り範囲を移動"
                    onPointerDown={(event) => startCropDrag(event, "move")}
                  />
                  {cropHandles.map(({ handle, label }) => (
                    <button
                      className={`crop-handle crop-handle-${handle}`}
                      type="button"
                      key={handle}
                      aria-label={label}
                      onPointerDown={(event) => startCropDrag(event, handle)}
                    />
                  ))}
                </div>
              </div>
              {cropMessage && <p className="crop-message" aria-live="polite">{cropMessage}</p>}
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
              </div>
            </div>
          )}

          {photo && (
            <div className="share-panel">
              <button
                className="copy-prompt-button"
                type="button"
                onClick={() => void copyAnalysisPrompt()}
              >
                {promptCopied ? "コピーしました" : "分析用の文章をコピー"}
              </button>
              <small className="copy-instruction">ChatGPTに貼り付けてください。</small>
              <button
                className="share-button"
                type="button"
                onClick={() => void shareCover()}
                disabled={!shareFile || sharing}
              >
                {sharing ? "共有画面を開いています…" : shareFile ? "画像を共有" : "共有画像を準備中…"}
              </button>
              <small>共有先でChatGPTを選ぶと、表紙画像を渡せます。</small>
            </div>
          )}

          <div className="fields">
            <label><span>タイトル</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="あとからでも入力できます" maxLength={160} /></label>
            <label><span>メモ <small>任意</small></span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="この本を選んだ理由など" maxLength={1000} rows={3} /></label>
          </div>
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="save-button" type="submit" disabled={saving || detecting || !photo}>
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
