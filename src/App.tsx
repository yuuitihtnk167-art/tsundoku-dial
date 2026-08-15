"use client";

import {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
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
  updateBookCategory,
  type BookCategory,
  type StoredBook,
} from "./storage";
import { lookupBookByIsbn } from "./book-lookup";
import { getTitleMatch } from "./book-match";
import { IsbnScanner } from "./IsbnScanner";

type Book = StoredBook & {
  coverUrl: string;
};

type DuplicateCandidate = {
  book: Book;
  reasons: string[];
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
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type DialPointer = {
  pointerId: number;
  centerX: number;
  centerY: number;
  lastPointerAngle: number;
  rotation: number;
  snappedRotation: number;
};

type BookCategoryOption = {
  id: BookCategory;
  label: string;
  dropLabel: string;
  angle: number;
};

const bookCategories: BookCategoryOption[] = [
  { id: "unclassified", label: "積読", dropLabel: "積読に戻す", angle: 0 },
  { id: "reread", label: "もう一度読みたい", dropLabel: "もう一度読みたい", angle: 72 },
  { id: "read", label: "読んだ", dropLabel: "読んだ", angle: 144 },
  { id: "owned", label: "持っている", dropLabel: "持っている", angle: 216 },
  { id: "reading", label: "今読んでいる", dropLabel: "今読んでいる", angle: 288 },
];

function getBookCategory(book: StoredBook): BookCategory {
  return book.category ?? "unclassified";
}

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
const bookDragScrollEdge = 88;
const bookDragMaximumScrollSpeed = 112;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function getBookDragScrollDelta(
  clientY: number,
  viewportHeight: number,
  lowerBoundary = viewportHeight,
) {
  const edge = Math.min(bookDragScrollEdge, viewportHeight / 4);
  if (clientY < edge) {
    return -Math.ceil(
      clamp((edge - clientY) / edge, 0, 1) * bookDragMaximumScrollSpeed,
    );
  }
  if (clientY > lowerBoundary - edge && clientY < lowerBoundary) {
    return Math.ceil(
      clamp((clientY - (lowerBoundary - edge)) / edge, 0, 1) *
        bookDragMaximumScrollSpeed,
    );
  }
  return 0;
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
  const [addDialogOpen, setAddDialogOpen] = useState(false);
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
  const [activeCategory, setActiveCategory] = useState<BookCategory>("unclassified");
  const [dialRotation, setDialRotation] = useState(0);
  const [dialTurning, setDialTurning] = useState(false);
  const [classificationPanelOpen, setClassificationPanelOpen] = useState(false);
  const [categoryDropActive, setCategoryDropActive] = useState<BookCategory | null>(null);
  const [classificationMessage, setClassificationMessage] = useState("");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [draggingBookId, setDraggingBookId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [deleteDropActive, setDeleteDropActive] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [isbn, setIsbn] = useState<string | null>(null);
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const [lookingUpBook, setLookingUpBook] = useState(false);
  const [bookLookupMessage, setBookLookupMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const addDialogRef = useRef<HTMLDialogElement>(null);
  const detailDialogRef = useRef<HTMLDialogElement>(null);
  const bookLookupAbortRef = useRef<AbortController | null>(null);
  const duplicateWarningRef = useRef<HTMLElement>(null);
  const titleRef = useRef("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cropDragRef = useRef<CropDrag | null>(null);
  const dialPointerRef = useRef<DialPointer | null>(null);
  const booksRef = useRef<Book[]>([]);
  const longPressTimerRef = useRef<number | null>(null);
  const bookAutoScrollFrameRef = useRef<number | null>(null);
  const bookPointerStartRef = useRef<BookPointerStart | null>(null);
  const selectedBookIdRef = useRef<string | null>(null);
  const draggingBookIdRef = useRef<string | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const dragMovedRef = useRef(false);
  const deleteDropActiveRef = useRef(false);
  const categoryDropActiveRef = useRef<BookCategory | null>(null);
  const lastReorderTargetRef = useRef<string | null>(null);
  const suppressBookClickRef = useRef(false);
  const coverUrlsRef = useRef<string[]>([]);
  const cropKey = [crop.left, crop.top, crop.right, crop.bottom].join(":");
  const shareFile =
    preparedShare?.source === photo && preparedShare.cropKey === cropKey
      ? preparedShare.file
      : null;
  const activeCategoryOption =
    bookCategories.find((category) => category.id === activeCategory) ?? bookCategories[0];
  const visibleBooks = books.filter((book) => getBookCategory(book) === activeCategory);
  const duplicateCandidates: DuplicateCandidate[] = books.flatMap((book) => {
    if (book.id === editingBookId) return [];
    const reasons: string[] = [];
    if (isbn && book.isbn === isbn) reasons.push("ISBNが一致");
    const titleMatch = getTitleMatch(title, book.title);
    if (titleMatch === "exact") reasons.push("タイトルが一致");
    if (titleMatch === "similar") reasons.push("タイトルが類似");
    return reasons.length > 0 ? [{ book, reasons }] : [];
  });
  const duplicateCandidateKey = duplicateCandidates
    .map(({ book, reasons }) => `${book.id}:${reasons.join(",")}`)
    .join("|");

  const stopBookLookup = useCallback(() => {
    bookLookupAbortRef.current?.abort();
    bookLookupAbortRef.current = null;
    setLookingUpBook(false);
  }, []);

  const updateIsbn = useCallback((nextIsbn: string | null) => {
    stopBookLookup();
    setIsbn(nextIsbn);
    setDuplicateConfirmed(false);
    if (!nextIsbn) {
      setBookLookupMessage("");
      return;
    }

    const controller = new AbortController();
    bookLookupAbortRef.current = controller;
    const lookupTimeout = window.setTimeout(() => {
      if (bookLookupAbortRef.current !== controller) return;
      setBookLookupMessage("書籍情報の取得に時間がかかっています。表紙撮影とタイトル入力で続けられます。");
      controller.abort();
    }, 10_000);
    setLookingUpBook(true);
    setBookLookupMessage("ISBNからタイトルと表紙を探しています…");
    void lookupBookByIsbn(nextIsbn, controller.signal)
      .then(async (result) => {
        if (controller.signal.aborted) return;
        if (result.title && !titleRef.current.trim()) {
          titleRef.current = result.title;
          setTitle(result.title);
          setDuplicateConfirmed(false);
        }

        let coverApplied = false;
        if (result.cover) {
          try {
            const normalized = await normalizePhoto(result.cover);
            if (controller.signal.aborted) return;
            setPhoto(normalized);
            setPhotoUrl((current) => {
              if (current) URL.revokeObjectURL(current);
              return URL.createObjectURL(normalized);
            });
            setPhotoAspectRatio(2 / 3);
            setCrop(fullCrop);
            setCropMessage("ISBNから表紙を取得しました。必要ならガイド付きで撮り直せます。");
            coverApplied = true;
          } catch {
            coverApplied = false;
          }
        }

        if (result.title && coverApplied) {
          setBookLookupMessage("タイトルと表紙を取得しました。");
        } else if (result.title) {
          setBookLookupMessage("タイトルを取得しました。表紙はガイド付きで撮影してください。");
        } else if (coverApplied) {
          setBookLookupMessage("表紙を取得しました。タイトルを入力してください。");
        } else {
          setBookLookupMessage("情報を取得できませんでした。タイトル入力と表紙撮影をお願いします。");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setBookLookupMessage("書籍情報を取得できませんでした。タイトル入力と表紙撮影をお願いします。");
        }
      })
      .finally(() => {
        window.clearTimeout(lookupTimeout);
        if (bookLookupAbortRef.current !== controller) return;
        bookLookupAbortRef.current = null;
        setLookingUpBook(false);
      });
  }, [stopBookLookup]);

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
    if (bookAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(bookAutoScrollFrameRef.current);
    }
  }, []);
  useEffect(() => {
    if (!selectedBookId) return;
    const clearSelectionOutsideBook = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-book-id]")) return;
      selectedBookIdRef.current = null;
      setSelectedBookId(null);
    };
    document.addEventListener("pointerdown", clearSelectionOutsideBook);
    return () => document.removeEventListener("pointerdown", clearSelectionOutsideBook);
  }, [selectedBookId]);
  useEffect(() => stopCamera, [stopCamera]);
  useEffect(() => () => bookLookupAbortRef.current?.abort(), []);
  useEffect(() => {
    if (!duplicateCandidateKey || duplicateConfirmed) return;
    const frame = window.requestAnimationFrame(() => {
      duplicateWarningRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [duplicateCandidateKey, duplicateConfirmed]);
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
    titleRef.current = "";
    setTitle("");
    setNotes("");
    setIsbn(null);
    setDuplicateConfirmed(false);
    stopBookLookup();
    setBookLookupMessage("");
    setError("");
    setAddDialogOpen(true);
    addDialogRef.current?.showModal();
  }

  function closeAddDialog() {
    stopCamera();
    stopBookLookup();
    setAddDialogOpen(false);
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
    stopBookLookup();
    if (isbn) setBookLookupMessage("ISBNは記録済みです。表紙をガイドに合わせて撮影してください。");
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
        ? "保存時の元画像から表紙を修正できます。"
        : "この本には元画像がないため、現在の表紙の範囲内で調整できます。",
    );
    setPromptCopied(false);
    titleRef.current = selectedBook.title;
    setTitle(selectedBook.title);
    setNotes(selectedBook.notes);
    setIsbn(selectedBook.isbn);
    setDuplicateConfirmed(false);
    setError("");
    detailDialogRef.current?.close();
    setSelectedBook(null);
    setAddDialogOpen(true);
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

  function dialPointerAngle(clientX: number, clientY: number, centerX: number, centerY: number) {
    return (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI + 90;
  }

  function normalizeAngleDelta(value: number) {
    if (value > 180) return value - 360;
    if (value < -180) return value + 360;
    return value;
  }

  function selectDialCategory(category: BookCategory) {
    const option = bookCategories.find((item) => item.id === category);
    if (!option) return;
    const nearestTurn = Math.round((dialRotation - option.angle) / 360);
    setDialRotation(option.angle + nearestTurn * 360);
    setActiveCategory(category);
    setClassificationMessage("");
    navigator.vibrate?.(12);
  }

  function startDialTurn(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    event.currentTarget.setPointerCapture(event.pointerId);
    dialPointerRef.current = {
      pointerId: event.pointerId,
      centerX,
      centerY,
      lastPointerAngle: dialPointerAngle(event.clientX, event.clientY, centerX, centerY),
      rotation: dialRotation,
      snappedRotation: dialRotation,
    };
    setDialTurning(true);
  }

  function turnDial(event: ReactPointerEvent<HTMLDivElement>) {
    const pointer = dialPointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    event.preventDefault();
    const nextPointerAngle = dialPointerAngle(
      event.clientX,
      event.clientY,
      pointer.centerX,
      pointer.centerY,
    );
    pointer.rotation += normalizeAngleDelta(nextPointerAngle - pointer.lastPointerAngle);
    pointer.lastPointerAngle = nextPointerAngle;
    const snappedRotation = Math.round(pointer.rotation / 72) * 72;
    if (snappedRotation === pointer.snappedRotation) return;

    pointer.snappedRotation = snappedRotation;
    const snappedAngle = ((snappedRotation % 360) + 360) % 360;
    const option = bookCategories.find((item) => item.angle === snappedAngle) ?? bookCategories[0];
    setDialRotation(snappedRotation);
    setActiveCategory(option.id);
    setClassificationMessage("");
    navigator.vibrate?.([12, 8, 18]);
  }

  function finishDialTurn(event: ReactPointerEvent<HTMLDivElement>) {
    const pointer = dialPointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const snappedRotation = pointer.snappedRotation;
    const snappedAngle = ((snappedRotation % 360) + 360) % 360;
    const option = bookCategories.find((item) => item.angle === snappedAngle) ?? bookCategories[0];
    dialPointerRef.current = null;
    setDialTurning(false);
    setDialRotation(snappedRotation);
    setActiveCategory(option.id);
    setClassificationMessage("");
    navigator.vibrate?.(18);
  }

  function handleDialKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = bookCategories.findIndex((category) => category.id === activeCategory);
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + direction + bookCategories.length) % bookCategories.length;
    selectDialCategory(bookCategories[nextIndex].id);
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

  function setCategoryTarget(category: BookCategory | null) {
    if (categoryDropActiveRef.current === category) return;
    categoryDropActiveRef.current = category;
    setCategoryDropActive(category);
  }

  function updateBookDragTargets(clientX: number, clientY: number, draggedId: string) {
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const overDelete = Boolean(element?.closest(".delete-drop-zone"));
    setDeleteTarget(overDelete);
    if (overDelete) {
      setCategoryTarget(null);
      return;
    }

    const categoryValue = element
      ?.closest<HTMLElement>("[data-category-drop]")
      ?.dataset.categoryDrop as BookCategory | undefined;
    const overCategory = bookCategories.some((category) => category.id === categoryValue)
      ? categoryValue ?? null
      : null;
    setCategoryTarget(overCategory);
    if (overCategory) return;

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

  function stopBookAutoScroll() {
    if (bookAutoScrollFrameRef.current === null) return;
    window.cancelAnimationFrame(bookAutoScrollFrameRef.current);
    bookAutoScrollFrameRef.current = null;
  }

  function startBookAutoScroll() {
    if (bookAutoScrollFrameRef.current !== null) return;

    const scrollFrame = () => {
      bookAutoScrollFrameRef.current = null;
      const pointer = bookPointerStartRef.current;
      const draggedId = draggingBookIdRef.current;
      if (!pointer || !draggedId) return;

      const element = document.elementFromPoint(
        pointer.currentX,
        pointer.currentY,
      ) as HTMLElement | null;
      if (element?.closest(".classification-tray")) return;

      const classificationTray = document.querySelector<HTMLElement>(".classification-tray");
      const lowerBoundary = classificationTray?.getBoundingClientRect().top ?? window.innerHeight;
      const scrollDelta = getBookDragScrollDelta(
        pointer.currentY,
        window.innerHeight,
        lowerBoundary,
      );
      if (scrollDelta === 0) return;

      const previousScrollY = window.scrollY;
      window.scrollBy({ top: scrollDelta, behavior: "instant" });
      if (window.scrollY === previousScrollY) return;

      dragMovedRef.current = true;
      updateBookDragTargets(pointer.currentX, pointer.currentY, draggedId);
      bookAutoScrollFrameRef.current = window.requestAnimationFrame(scrollFrame);
    };

    bookAutoScrollFrameRef.current = window.requestAnimationFrame(scrollFrame);
  }

  function selectBookForDragging(bookId: string, x: number, y: number) {
    selectedBookIdRef.current = bookId;
    setSelectedBookId(bookId);
    draggingBookIdRef.current = bookId;
    dragOriginRef.current = { x, y };
    dragMovedRef.current = false;
    lastReorderTargetRef.current = bookId;
    suppressBookClickRef.current = true;
    setDraggingBookId(bookId);
    setDragPosition({ x, y });
  }

  function clearBookSelection() {
    selectedBookIdRef.current = null;
    setSelectedBookId(null);
  }

  function startBookPress(event: ReactPointerEvent<HTMLButtonElement>, bookId: string) {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    clearLongPressTimer();
    event.currentTarget.setPointerCapture(event.pointerId);
    bookPointerStartRef.current = {
      pointerId: event.pointerId,
      bookId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
    };
    if (selectedBookIdRef.current === bookId) {
      selectBookForDragging(bookId, event.clientX, event.clientY);
      return;
    }
    longPressTimerRef.current = window.setTimeout(() => {
      const pointer = bookPointerStartRef.current;
      if (!pointer || pointer.bookId !== bookId) return;
      selectBookForDragging(bookId, pointer.currentX, pointer.currentY);
      navigator.vibrate?.(25);
    }, 300);
  }

  function moveBook(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointerStart = bookPointerStartRef.current;
    if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;
    pointerStart.currentX = event.clientX;
    pointerStart.currentY = event.clientY;
    const distance = Math.hypot(
      event.clientX - pointerStart.startX,
      event.clientY - pointerStart.startY,
    );
    if (!draggingBookIdRef.current && distance > 18) {
      clearLongPressTimer();
      return;
    }

    const draggedId = draggingBookIdRef.current;
    if (!draggedId) return;
    event.preventDefault();
    const dragOrigin = dragOriginRef.current;
    if (dragOrigin && Math.hypot(event.clientX - dragOrigin.x, event.clientY - dragOrigin.y) > 4) {
      dragMovedRef.current = true;
    }
    setDragPosition({ x: event.clientX, y: event.clientY });
    updateBookDragTargets(event.clientX, event.clientY, draggedId);
    startBookAutoScroll();
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

  async function classifyDraggedBook(bookId: string, category: BookCategory) {
    const book = booksRef.current.find((item) => item.id === bookId);
    if (!book) return;
    try {
      await updateBookCategory(bookId, category);
      const next = booksRef.current.map((item) =>
        item.id === bookId ? { ...item, category } : item
      );
      booksRef.current = next;
      setBooks(next);
      const label =
        bookCategories.find((item) => item.id === category)?.dropLabel ?? "積読に戻す";
      setClassificationMessage(`「${book.title}」を「${label}」に分類しました。`);
      setError("");
    } catch (categoryError) {
      setError(categoryError instanceof Error ? categoryError.message : "本を分類できませんでした。");
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
    stopBookAutoScroll();
    bookPointerStartRef.current = null;

    const draggedId = draggingBookIdRef.current;
    if (!draggedId) return;
    const shouldDelete = allowDelete && deleteDropActiveRef.current;
    const targetCategory = allowDelete ? categoryDropActiveRef.current : null;
    const shouldFinishDrag = allowDelete && dragMovedRef.current;
    draggingBookIdRef.current = null;
    dragOriginRef.current = null;
    dragMovedRef.current = false;
    lastReorderTargetRef.current = null;
    setDeleteTarget(false);
    setCategoryTarget(null);
    setDraggingBookId(null);
    setDragPosition(null);
    window.setTimeout(() => {
      suppressBookClickRef.current = false;
    }, 0);

    if (shouldDelete) {
      clearBookSelection();
      void removeDraggedBook(draggedId);
    } else if (targetCategory) {
      clearBookSelection();
      void classifyDraggedBook(draggedId, targetCategory);
    } else if (shouldFinishDrag) {
      clearBookSelection();
      void persistCurrentBookOrder();
    }
  }

  function openBook(book: Book) {
    if (suppressBookClickRef.current) return;
    clearBookSelection();
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
    if (duplicateCandidates.length > 0 && !duplicateConfirmed) {
      setError("重複候補を確認してから、登録するか判断してください。");
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
        isbn,
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
      <header className="topbar" id="top">
        <a className="brand" href="#top" aria-label="積読ダイヤル ホーム">
          <span className="brand-mark" aria-hidden="true">本</span>
          <span>積読ダイヤル</span>
        </a>
        <button className="add-button" type="button" onClick={openAddDialog}>
          <span aria-hidden="true">＋</span> 表紙を撮る
        </button>
      </header>

      <section className="category-console" aria-labelledby="category-dial-title">
        <div className="console-nameplate">
          <span aria-hidden="true" />
          <h1 id="category-dial-title">積読ダイヤル</h1>
          <span aria-hidden="true" />
        </div>
        <div className="category-dial">
          {bookCategories.map((category) => (
            <button
              className={`dial-category dial-category-${category.id}`}
              type="button"
              key={category.id}
              aria-pressed={activeCategory === category.id}
              onClick={() => selectDialCategory(category.id)}
            >
              {category.label}
            </button>
          ))}
          <div
            className={dialTurning ? "dial-control is-turning" : "dial-control"}
            role="slider"
            tabIndex={0}
            aria-label="表示する本の分類"
            aria-valuemin={1}
            aria-valuemax={bookCategories.length}
            aria-valuenow={bookCategories.findIndex((item) => item.id === activeCategory) + 1}
            aria-valuetext={activeCategoryOption.label}
            onKeyDown={handleDialKeyDown}
            onPointerDown={startDialTurn}
            onPointerMove={turnDial}
            onPointerUp={finishDialTurn}
            onPointerCancel={finishDialTurn}
          >
            <div className="dial-bezel" aria-hidden="true">
              <span
                className="dial-knob"
                style={{ transform: `rotate(${dialRotation}deg)` }}
              >
                <i className="dial-pointer" />
              </span>
              <span className="dial-channel-window">
                {String(bookCategories.findIndex((item) => item.id === activeCategory) + 1).padStart(2, "0")}
              </span>
            </div>
          </div>
        </div>
        <p className="category-counter" aria-live="polite">
          <span aria-hidden="true" />
          {activeCategory === "unclassified" ? "積読・未分類" : activeCategoryOption.label}
          <strong>{visibleBooks.length}冊</strong>
          <span aria-hidden="true" />
        </p>
        <p className="dial-help">ダイヤルを回すか、分類名をタップしてください</p>
      </section>

      <section className="shelf" aria-labelledby="shelf-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">BOOKSHELF</p>
            <h2 id="shelf-title">わたしの本棚</h2>
          </div>
          <div className="shelf-actions">
            <p>長押しで並べ替え・分類・削除</p>
            <button
              className="classification-toggle"
              type="button"
              aria-expanded={classificationPanelOpen}
              onClick={() => {
                setClassificationPanelOpen((current) => !current);
                setClassificationMessage("");
              }}
              disabled={books.length === 0}
            >
              {classificationPanelOpen ? "分類盤を閉じる" : "分類盤を表示する"}
            </button>
          </div>
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
        ) : visibleBooks.length === 0 ? (
          <div className="category-empty">
            <h3>この分類には、まだ本がありません</h3>
            <p>ほかの分類をダイヤルで表示し、表紙を長押しして分類してください。</p>
          </div>
        ) : (
          <div className="book-grid">
            {visibleBooks.map((book, index) => (
              <button
                className={[
                  "book-card",
                  book.id === selectedBookId ? "is-selected" : "",
                  book.id === draggingBookId ? "is-dragging" : "",
                ].filter(Boolean).join(" ")}
                type="button"
                key={book.id}
                data-book-id={book.id}
                aria-pressed={book.id === selectedBookId}
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
        {selectedBookId && !draggingBookId && !classificationPanelOpen && (
          <p className="book-selection-hint" role="status">
            つかみました。もう一度動かすと並べ替え・分類・削除できます。空いている場所をタップすると解除します。
          </p>
        )}
      </section>

      {classificationPanelOpen && books.length > 0 && (
        <aside
          className={draggingBookId ? "classification-tray is-dragging" : "classification-tray"}
          aria-label="本の分類先"
        >
          <div className="classification-tray-heading">
            <div>
              <strong>分類盤</strong>
              <small>本を長押しして移動</small>
            </div>
            <button
              type="button"
              aria-label="分類盤を閉じる"
              onClick={() => setClassificationPanelOpen(false)}
              disabled={Boolean(draggingBookId)}
            >
              ×
            </button>
          </div>
          <div className="category-drop-grid">
            {bookCategories.map((category) => (
              <button
                className={categoryDropActive === category.id ? "category-drop-target is-active" : "category-drop-target"}
                type="button"
                key={category.id}
                data-category-drop={category.id}
                disabled={!draggingBookId}
              >
                <span aria-hidden="true" />
                {category.dropLabel}
              </button>
            ))}
            <button
              className={deleteDropActive ? "delete-drop-zone is-active" : "delete-drop-zone"}
              type="button"
              disabled={!draggingBookId}
            >
              <span aria-hidden="true">×</span>
              {deleteDropActive ? "ここで離して削除" : "削除"}
            </button>
          </div>
          {classificationMessage && (
            <p className="classification-message" role="status">{classificationMessage}</p>
          )}
        </aside>
      )}

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
      <dialog
        className="add-dialog"
        ref={addDialogRef}
        onClose={() => {
          stopCamera();
          stopBookLookup();
          setAddDialogOpen(false);
          setError("");
        }}
      >
        <form onSubmit={saveBook}>
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">{editingBookId ? "EDIT COVER" : "NEW BOOK"}</p>
              {editingBookId && <h2>修正</h2>}
            </div>
            <button className="close-button" type="button" onClick={closeAddDialog} aria-label="閉じる">×</button>
          </div>

          {duplicateCandidates.length > 0 && !duplicateConfirmed && (
            <section ref={duplicateWarningRef} className="duplicate-warning" aria-labelledby="duplicate-warning-title">
              <h3 id="duplicate-warning-title">重複している可能性があります</h3>
              <p>次の本を確認して、登録をやめるか続けるか選んでください。</p>
              <div className="duplicate-list">
                {duplicateCandidates.map(({ book, reasons }) => (
                  <article className="duplicate-candidate" key={book.id}>
                    <img src={book.coverUrl} alt="" />
                    <div>
                      <strong>{book.title}</strong>
                      <small>{formatDate(book.createdAt)}</small>
                      <span>{reasons.join("・")}</span>
                    </div>
                  </article>
                ))}
              </div>
              <div className="duplicate-actions">
                <button className="duplicate-cancel-button" type="button" onClick={closeAddDialog}>やめる</button>
                <button
                  className="duplicate-confirm-button"
                  type="button"
                  onClick={() => {
                    setDuplicateConfirmed(true);
                    setError("");
                  }}
                >
                  続ける
                </button>
              </div>
            </section>
          )}

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
                style={{
                  aspectRatio: photoAspectRatio,
                  "--crop-stage-mobile-width": `${58 * photoAspectRatio}dvh`,
                } as CSSProperties}
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
              <div className="crop-scroll-area">
                {cropMessage && <p className="crop-message" aria-live="polite">{cropMessage}</p>}
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
              </div>
            </div>
          )}

          {!cameraActive && addDialogOpen && (
            <>
              <IsbnScanner isbn={isbn} onIsbnChange={updateIsbn} />
              {bookLookupMessage && (
                <p className="book-lookup-message" aria-live="polite">{bookLookupMessage}</p>
              )}
            </>
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
            <label><span>タイトル</span><input value={title} onChange={(event) => {
              titleRef.current = event.target.value;
              setTitle(event.target.value);
              setDuplicateConfirmed(false);
            }} placeholder="あとからでも入力できます" maxLength={160} /></label>
            <label><span>メモ <small>任意</small></span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="この本を選んだ理由など" maxLength={1000} rows={3} /></label>
          </div>

          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="save-button" type="submit" disabled={saving || detecting || lookingUpBook || !photo}>
            {saving ? "保存しています…" : editingBookId ? "更新" : "この本を積む"}
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
                修正
              </button>
            </div>
          </section>
        )}
      </dialog>
    </main>
  );
}
