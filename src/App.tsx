"use client";

import {
  ChangeEvent,
  CSSProperties,
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
  replaceBooks,
  saveBookOrder,
  updateBook,
  updateBookCategory,
  type BookCategory,
  type StoredBook,
} from "./storage";
import {
  isAvailableCategoryDrop,
  resolveCompletedDropTarget,
  type DragDropTarget,
} from "./book-drop";
import { lookupBookByIsbn } from "./book-lookup";
import { getTitleMatch } from "./book-match";
import { IsbnScanner } from "./IsbnScanner";
import { createCompleteBackup, parseCompleteBackup, type ParsedBackup } from "./backup";

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
  pointerType: string;
  bookId: string;
  source: HTMLButtonElement;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type CategoryRegistrationPointerStart = {
  pointerId: number;
  category: BookCategory;
  source: HTMLElement;
  startX: number;
  startY: number;
};

type BookCategoryOption = {
  id: BookCategory;
  label: string;
  dropLabel: string;
};

type BookViewMode = "dial" | "shelf";
type BookDisplayDensity = "covers" | "compact";

type BookDropTarget = DragDropTarget<BookCategory>;

type BookPointerEvent = Pick<PointerEvent, "pointerId" | "clientX" | "clientY">;

const bookCategories: BookCategoryOption[] = [
  { id: "unclassified", label: "積読", dropLabel: "積読に戻す" },
  { id: "reread", label: "もう一度読みたい", dropLabel: "もう一度読みたい" },
  { id: "read", label: "読んだ", dropLabel: "読んだ" },
  { id: "owned", label: "持っている", dropLabel: "持っている" },
  { id: "reading", label: "今読んでいる", dropLabel: "今読んでいる" },
];

const shelfCategoryOrder: BookCategory[] = [
  "unclassified",
  "reading",
  "reread",
  "owned",
  "read",
];
const bookViewModeStorageKey = "tsundoku-dial-book-view-mode";
const bookDisplayDensityStorageKey = "tsundoku-dial-book-display-density";
const categoryRegistrationLongPressDelay = 300;
const categoryRegistrationMoveThreshold = 10;

function getInitialBookViewMode(): BookViewMode {
  try {
    return window.localStorage.getItem(bookViewModeStorageKey) === "shelf"
      ? "shelf"
      : "dial";
  } catch {
    return "dial";
  }
}

function getInitialBookDisplayDensity(): BookDisplayDensity {
  try {
    return window.localStorage.getItem(bookDisplayDensityStorageKey) === "compact"
      ? "compact"
      : "covers";
  } catch {
    return "covers";
  }
}

function getBookCategory(book: StoredBook): BookCategory {
  return book.category ?? "unclassified";
}

type RectBounds = Pick<DOMRect, "left" | "top" | "right" | "bottom">;

function distanceFromPointToRect(clientX: number, clientY: number, bounds: RectBounds) {
  const horizontalDistance = clientX < bounds.left
    ? bounds.left - clientX
    : clientX > bounds.right ? clientX - bounds.right : 0;
  const verticalDistance = clientY < bounds.top
    ? bounds.top - clientY
    : clientY > bounds.bottom ? clientY - bounds.bottom : 0;
  return Math.hypot(horizontalDistance, verticalDistance);
}

function overlapArea(first: RectBounds, second: RectBounds) {
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  return width * height;
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
  "最初に、本のタイトル、著者名、出版社名を、それぞれ独立したコードブロックで出力してください。",
  "",
  "```text",
  "本の正式タイトル",
  "```",
  "",
  "```text",
  "著者名",
  "```",
  "",
  "```text",
  "出版社名",
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

function createTitleAnalysisPrompt(inputTitle: string) {
  return [
    "次のタイトルに該当する本をWebで調べ、読書記録アプリに保存するための情報を作成してください。",
    "",
    "【入力したタイトル】",
    "",
    `「${inputTitle}」`,
    "",
    "【調査】",
    "",
    "- 入力したタイトルから、該当する本の正式な書名、著者名、出版社などを確認してください。",
    "- 出版社の公式書籍ページ、著者の公式情報など、信頼できる情報を優先してください。",
    "- 同名の本や複数の版があり、どの本か判断できない場合は候補を提示し、勝手に決めないでください。",
    "- 確認できない情報を推測で書かないでください。",
    "- 確認できない情報は「確認できない」としてください。",
    "",
    "【出力形式】",
    "",
    "最初に、本の正式タイトル、著者名、出版社名を、それぞれ独立したコードブロックで出力してください。",
    "",
    "```text",
    "本の正式タイトル",
    "```",
    "",
    "```text",
    "著者名",
    "```",
    "",
    "```text",
    "出版社名",
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
    "",
    "【表紙画像】",
    "",
    "- 特定した本と同じ版の表紙画像を1点探してください。",
    "- AIで新しい表紙画像を生成せず、実在する本の表紙を使用してください。",
    "- 画像と、その画像を確認した書籍ページのリンクを表示してください。",
    "- 該当する表紙を確認できない場合は、別の本の画像を表示せず「表紙画像を確認できない」としてください。",
  ].join("\n");
}

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

function getBookDragHorizontalScrollDelta(
  clientX: number,
  leftBoundary: number,
  rightBoundary: number,
) {
  const width = rightBoundary - leftBoundary;
  const edge = Math.min(bookDragScrollEdge, width / 4);
  if (clientX < leftBoundary + edge && clientX > leftBoundary) {
    return -Math.ceil(
      clamp((leftBoundary + edge - clientX) / edge, 0, 1) *
        bookDragMaximumScrollSpeed,
    );
  }
  if (clientX > rightBoundary - edge && clientX < rightBoundary) {
    return Math.ceil(
      clamp((clientX - (rightBoundary - edge)) / edge, 0, 1) *
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
  const [titlePromptCopied, setTitlePromptCopied] = useState(false);
  const [titleSharing, setTitleSharing] = useState(false);
  const [pastingCover, setPastingCover] = useState(false);
  const [activeCategory, setActiveCategory] = useState<BookCategory>("unclassified");
  const [registrationCategory, setRegistrationCategory] = useState<BookCategory>("unclassified");
  const [bookViewMode, setBookViewMode] = useState<BookViewMode>(getInitialBookViewMode);
  const [bookDisplayDensity, setBookDisplayDensity] = useState<BookDisplayDensity>(getInitialBookDisplayDensity);
  const [categoryDropActive, setCategoryDropActive] = useState<BookCategory | null>(null);
  const [classificationMessage, setClassificationMessage] = useState("");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [draggingBookId, setDraggingBookId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [deleteDropActive, setDeleteDropActive] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [publisher, setPublisher] = useState("");
  const [notes, setNotes] = useState("");
  const [isbn, setIsbn] = useState<string | null>(null);
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const [lookingUpBook, setLookingUpBook] = useState(false);
  const [bookLookupMessage, setBookLookupMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsError, setSettingsError] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<ParsedBackup | null>(null);
  const addDialogRef = useRef<HTMLDialogElement>(null);
  const detailDialogRef = useRef<HTMLDialogElement>(null);
  const settingsDialogRef = useRef<HTMLDialogElement>(null);
  const bookLookupAbortRef = useRef<AbortController | null>(null);
  const duplicateWarningRef = useRef<HTMLElement>(null);
  const titleRef = useRef("");
  const authorRef = useRef("");
  const publisherRef = useRef("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cropDragRef = useRef<CropDrag | null>(null);
  const booksRef = useRef<Book[]>([]);
  const longPressTimerRef = useRef<number | null>(null);
  const categoryRegistrationTimerRef = useRef<number | null>(null);
  const categoryRegistrationPointerRef = useRef<CategoryRegistrationPointerStart | null>(null);
  const suppressCategoryClickRef = useRef(false);
  const bookAutoScrollFrameRef = useRef<number | null>(null);
  const bookPointerStartRef = useRef<BookPointerStart | null>(null);
  const selectedBookIdRef = useRef<string | null>(null);
  const draggingBookIdRef = useRef<string | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const dragMovedRef = useRef(false);
  const deleteDropActiveRef = useRef(false);
  const categoryDropActiveRef = useRef<BookCategory | null>(null);
  const bookDropTargetRef = useRef<BookDropTarget>(null);
  const lastReorderTargetRef = useRef<string | null>(null);
  const bookDragListenersCleanupRef = useRef<(() => void) | null>(null);
  const suppressBookClickRef = useRef(false);
  const coverUrlsRef = useRef<string[]>([]);
  const cropKey = [crop.left, crop.top, crop.right, crop.bottom].join(":");
  const shareFile =
    preparedShare?.source === photo && preparedShare.cropKey === cropKey
      ? preparedShare.file
      : null;
  const activeCategoryOption =
    bookCategories.find((category) => category.id === activeCategory) ?? bookCategories[0];
  const registrationCategoryOption =
    bookCategories.find((category) => category.id === registrationCategory) ?? bookCategories[0];
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
      setBookLookupMessage("書籍情報の取得に時間がかかっています。表紙撮影と書籍情報の入力で続けられます。");
      controller.abort();
    }, 10_000);
    setLookingUpBook(true);
    setBookLookupMessage("ISBNからタイトル、著者名、出版社名、表紙を探しています…");
    void lookupBookByIsbn(nextIsbn, controller.signal)
      .then(async (result) => {
        if (controller.signal.aborted) return;
        if (result.title && !titleRef.current.trim()) {
          titleRef.current = result.title;
          setTitle(result.title);
          setTitlePromptCopied(false);
          setDuplicateConfirmed(false);
        }
        if (result.author && !authorRef.current.trim()) {
          authorRef.current = result.author;
          setAuthor(result.author);
        }
        if (result.publisher && !publisherRef.current.trim()) {
          publisherRef.current = result.publisher;
          setPublisher(result.publisher);
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

        const bibliographicDataFound = Boolean(result.title || result.author || result.publisher);
        if (bibliographicDataFound && coverApplied) {
          setBookLookupMessage("書籍情報と表紙を取得しました。");
        } else if (bibliographicDataFound) {
          setBookLookupMessage("書籍情報を取得しました。表紙はガイド付きで撮影してください。");
        } else if (coverApplied) {
          setBookLookupMessage("表紙を取得しました。書籍情報を入力してください。");
        } else {
          setBookLookupMessage("情報を取得できませんでした。書籍情報の入力と表紙撮影をお願いします。");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setBookLookupMessage("書籍情報を取得できませんでした。書籍情報の入力と表紙撮影をお願いします。");
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
    bookDragListenersCleanupRef.current?.();
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
    }
    if (categoryRegistrationTimerRef.current !== null) {
      window.clearTimeout(categoryRegistrationTimerRef.current);
    }
    if (bookAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(bookAutoScrollFrameRef.current);
    }
  }, []);
  useEffect(() => {
    const preventScrollWhileDragging = (event: TouchEvent) => {
      if (draggingBookIdRef.current) event.preventDefault();
    };
    document.addEventListener("touchmove", preventScrollWhileDragging, { passive: false });
    return () => document.removeEventListener("touchmove", preventScrollWhileDragging);
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

  function openAddDialog(category: BookCategory) {
    stopCamera();
    setEditingBookId(null);
    setRegistrationCategory(category);
    setPhoto(null);
    setPhotoUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
    setCrop(initialCrop);
    setPhotoAspectRatio(2 / 3);
    setCropMessage("");
    setPromptCopied(false);
    setTitlePromptCopied(false);
    titleRef.current = "";
    setTitle("");
    authorRef.current = "";
    setAuthor("");
    publisherRef.current = "";
    setPublisher("");
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
      return true;
    } catch (photoError) {
      setError(
        photoError instanceof Error
          ? photoError.message
          : "撮影した画像を処理できませんでした。",
      );
      return false;
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
    setTitlePromptCopied(false);
    titleRef.current = selectedBook.title;
    setTitle(selectedBook.title);
    authorRef.current = selectedBook.author ?? "";
    setAuthor(selectedBook.author ?? "");
    publisherRef.current = selectedBook.publisher ?? "";
    setPublisher(selectedBook.publisher ?? "");
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

  function selectCategory(category: BookCategory) {
    setActiveCategory(category);
    setClassificationMessage("");
    navigator.vibrate?.(12);
  }

  function clearCategoryRegistrationTimer() {
    if (categoryRegistrationTimerRef.current === null) return;
    window.clearTimeout(categoryRegistrationTimerRef.current);
    categoryRegistrationTimerRef.current = null;
  }

  function startCategoryRegistrationPress(
    event: ReactPointerEvent<HTMLElement>,
    category: BookCategory,
  ) {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    clearCategoryRegistrationTimer();
    categoryRegistrationPointerRef.current = {
      pointerId: event.pointerId,
      category,
      source: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    categoryRegistrationTimerRef.current = window.setTimeout(() => {
      const pointer = categoryRegistrationPointerRef.current;
      if (!pointer || pointer.category !== category) return;
      categoryRegistrationPointerRef.current = null;
      categoryRegistrationTimerRef.current = null;
      suppressCategoryClickRef.current = true;
      window.setTimeout(() => {
        suppressCategoryClickRef.current = false;
      }, 500);
      if (pointer.source.hasPointerCapture(pointer.pointerId)) {
        pointer.source.releasePointerCapture(pointer.pointerId);
      }
      if (bookViewMode === "dial") selectCategory(category);
      openAddDialog(category);
      navigator.vibrate?.(25);
    }, categoryRegistrationLongPressDelay);
  }

  function moveCategoryRegistrationPress(event: ReactPointerEvent<HTMLElement>) {
    const pointer = categoryRegistrationPointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - pointer.startX,
      event.clientY - pointer.startY,
    );
    if (distance <= categoryRegistrationMoveThreshold) return;
    clearCategoryRegistrationTimer();
    categoryRegistrationPointerRef.current = null;
  }

  function finishCategoryRegistrationPress(event: ReactPointerEvent<HTMLElement>) {
    const pointer = categoryRegistrationPointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    clearCategoryRegistrationTimer();
    categoryRegistrationPointerRef.current = null;
  }

  function handleCategoryClick(category: BookCategory) {
    if (suppressCategoryClickRef.current) return;
    selectCategory(category);
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

  function resolveBookDropTarget(
    clientX: number,
    clientY: number,
    draggedId: string,
  ): BookDropTarget {
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const draggedBook = booksRef.current.find((book) => book.id === draggedId);
    const draggedCategory = draggedBook ? getBookCategory(draggedBook) : null;
    const isValidDropElement = (candidate: HTMLElement) => {
      if (candidate.dataset.bookDrop === "delete") return true;
      if (candidate.dataset.bookDrop !== "category") return false;
      const category = candidate.dataset.categoryDrop as BookCategory | undefined;
      return isAvailableCategoryDrop(category, draggedCategory) &&
        bookCategories.some((option) => option.id === category);
    };
    const directDropElement = element?.closest<HTMLElement>("[data-book-drop]") ?? null;
    let dropElement = directDropElement && isValidDropElement(directDropElement)
      ? directDropElement
      : null;
    const dropContainer = element?.closest<HTMLElement>("[data-book-drop-container]");

    if (!directDropElement && dropContainer) {
      const candidates = Array.from(
        dropContainer.querySelectorAll<HTMLElement>("[data-book-drop]"),
      ).filter(isValidDropElement);
      dropElement = candidates.reduce<HTMLElement | null>((nearest, candidate) => {
        if (!nearest) return candidate;
        const candidateBounds = candidate.getBoundingClientRect();
        const nearestBounds = nearest.getBoundingClientRect();
        return distanceFromPointToRect(clientX, clientY, candidateBounds) <
          distanceFromPointToRect(clientX, clientY, nearestBounds)
          ? candidate
          : nearest;
      }, null);
    }

    if (!dropElement) {
      const dragPreview = document.querySelector<HTMLElement>(".book-drag-preview");
      if (dragPreview) {
        const previewBounds = dragPreview.getBoundingClientRect();
        const draggedCoverBounds: RectBounds = {
          left: clientX - previewBounds.width / 2,
          right: clientX + previewBounds.width / 2,
          top: clientY - previewBounds.height / 2,
          bottom: clientY + previewBounds.height / 2,
        };
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>("[data-book-drop]"),
        ).filter(isValidDropElement);
        let largestOverlap = 0;
        dropElement = candidates.reduce<HTMLElement | null>((best, candidate) => {
          const candidateOverlap = overlapArea(
            draggedCoverBounds,
            candidate.getBoundingClientRect(),
          );
          if (candidateOverlap <= largestOverlap) return best;
          largestOverlap = candidateOverlap;
          return candidate;
        }, null);
      }
    }

    if (dropElement?.dataset.bookDrop === "delete") return { type: "delete" };
    if (dropElement?.dataset.bookDrop !== "category") return null;

    const categoryValue = dropElement.dataset.categoryDrop as BookCategory | undefined;
    if (!categoryValue) return null;

    return {
      type: "category",
      category: categoryValue,
      bookId: element?.closest<HTMLElement>("[data-book-id]")?.dataset.bookId ?? null,
    };
  }

  function updateBookDragTargets(clientX: number, clientY: number, draggedId: string) {
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const dropTarget = resolveBookDropTarget(clientX, clientY, draggedId);
    bookDropTargetRef.current = dropTarget;
    const overDelete = dropTarget?.type === "delete";
    setDeleteTarget(overDelete);
    if (overDelete) {
      setCategoryTarget(null);
      return;
    }

    const overCategory = dropTarget?.type === "category" ? dropTarget.category : null;
    setCategoryTarget(overCategory);
    if (overCategory) {
      return;
    }

    const draggedBook = booksRef.current.find((book) => book.id === draggedId);
    const draggedCategory = draggedBook ? getBookCategory(draggedBook) : null;
    const targetId = element?.closest<HTMLElement>("[data-book-id]")?.dataset.bookId;
    if (!targetId || targetId === draggedId) {
      lastReorderTargetRef.current = null;
      return;
    }
    const targetBook = booksRef.current.find((book) => book.id === targetId);
    if (!targetBook || getBookCategory(targetBook) !== draggedCategory) {
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

      const shelfRow = element?.closest<HTMLElement>(".bookshelf-row-scroll");
      if (!shelfRow && element?.closest("[data-book-drop]")) return;
      let rowScrolled = false;
      if (shelfRow) {
        const rowBounds = shelfRow.getBoundingClientRect();
        const horizontalDelta = getBookDragHorizontalScrollDelta(
          pointer.currentX,
          rowBounds.left,
          rowBounds.right,
        );
        if (horizontalDelta !== 0) {
          const previousScrollLeft = shelfRow.scrollLeft;
          shelfRow.scrollBy({ left: horizontalDelta, behavior: "instant" });
          rowScrolled = shelfRow.scrollLeft !== previousScrollLeft;
        }
      }

      const scrollDelta = getBookDragScrollDelta(
        pointer.currentY,
        window.innerHeight,
        window.innerHeight,
      );
      const previousScrollY = window.scrollY;
      if (scrollDelta !== 0) {
        window.scrollBy({ top: scrollDelta, behavior: "instant" });
      }
      const pageScrolled = window.scrollY !== previousScrollY;
      if (!rowScrolled && !pageScrolled) return;

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
    bookDropTargetRef.current = null;
    lastReorderTargetRef.current = bookId;
    suppressBookClickRef.current = true;
    setDraggingBookId(bookId);
    setDragPosition({ x, y });
  }

  function listenForBookDragEvents(source: HTMLButtonElement, pointerId: number) {
    bookDragListenersCleanupRef.current?.();

    const handlePointerMove = (event: PointerEvent) => {
      if (event.defaultPrevented || event.pointerId !== pointerId) return;
      moveBook(event);
    };
    const handlePointerUp = (event: PointerEvent) => {
      finishBookPress(event, "release");
    };
    const handlePointerCancel = (event: PointerEvent) => {
      finishBookPress(event, "cancel");
    };
    const handleLostPointerCapture = (event: PointerEvent) => {
      if (event.pointerId !== pointerId || event.buttons !== 0) return;
      window.setTimeout(() => {
        const pointer = bookPointerStartRef.current;
        if (!pointer || pointer.pointerId !== pointerId) return;
        finishBookPress({
          pointerId,
          clientX: pointer.currentX,
          clientY: pointer.currentY,
        }, "release");
      }, 0);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      source.removeEventListener("lostpointercapture", handleLostPointerCapture);
      if (bookDragListenersCleanupRef.current === cleanup) {
        bookDragListenersCleanupRef.current = null;
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    source.addEventListener("lostpointercapture", handleLostPointerCapture);
    bookDragListenersCleanupRef.current = cleanup;
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
      pointerType: event.pointerType,
      bookId,
      source: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
    };
    if (selectedBookIdRef.current === bookId) {
      selectBookForDragging(bookId, event.clientX, event.clientY);
      listenForBookDragEvents(event.currentTarget, event.pointerId);
      return;
    }
    if (event.pointerType === "mouse") return;
    longPressTimerRef.current = window.setTimeout(() => {
      const pointer = bookPointerStartRef.current;
      if (!pointer || pointer.bookId !== bookId) return;
      selectBookForDragging(bookId, pointer.currentX, pointer.currentY);
      listenForBookDragEvents(pointer.source, pointer.pointerId);
      navigator.vibrate?.(25);
    }, 300);
  }

  function moveBook(event: BookPointerEvent & { preventDefault(): void }) {
    const pointerStart = bookPointerStartRef.current;
    if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;
    pointerStart.currentX = event.clientX;
    pointerStart.currentY = event.clientY;
    const distance = Math.hypot(
      event.clientX - pointerStart.startX,
      event.clientY - pointerStart.startY,
    );
    if (!draggingBookIdRef.current && pointerStart.pointerType === "mouse" && distance > 6) {
      clearLongPressTimer();
      selectBookForDragging(
        pointerStart.bookId,
        pointerStart.startX,
        pointerStart.startY,
      );
      listenForBookDragEvents(pointerStart.source, pointerStart.pointerId);
    }
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
    if (!book) {
      setError("削除する本を確認できませんでした。");
      return;
    }
    const confirmed = window.confirm(
      `「${book.title}」を削除しますか？\nこの操作は取り消せません。`,
    );
    if (!confirmed) {
      setClassificationMessage("削除をキャンセルしました。");
      return;
    }

    try {
      await deleteBook(bookId);
      URL.revokeObjectURL(book.coverUrl);
      const next = booksRef.current.filter((item) => item.id !== bookId);
      booksRef.current = next;
      setBooks(next);
      setError("");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "本を削除できませんでした。");
    }
  }

  async function classifyDraggedBook(
    bookId: string,
    category: BookCategory,
    targetBookId: string | null,
  ) {
    const book = booksRef.current.find((item) => item.id === bookId);
    if (!book) return;
    try {
      await updateBookCategory(bookId, category);
    } catch (categoryError) {
      setError(categoryError instanceof Error ? categoryError.message : "本を分類できませんでした。");
      return;
    }

    const categorizedBook = { ...book, category };
    const next = booksRef.current.filter((item) => item.id !== bookId);
    const targetIndex = targetBookId
      ? next.findIndex((item) => item.id === targetBookId)
      : -1;
    if (targetIndex >= 0) {
      next.splice(targetIndex, 0, categorizedBook);
    } else {
      let lastCategoryIndex = -1;
      next.forEach((item, index) => {
        if (getBookCategory(item) === category) lastCategoryIndex = index;
      });
      next.splice(lastCategoryIndex + 1, 0, categorizedBook);
    }
    booksRef.current = next;
    setBooks(next);

    try {
      await saveBookOrder(next.map((item) => item.id));
      const label =
        bookCategories.find((item) => item.id === category)?.dropLabel ?? "積読に戻す";
      setClassificationMessage(`「${book.title}」を「${label}」に分類しました。`);
      setError("");
    } catch (orderError) {
      setError(orderError instanceof Error
        ? `分類は変更しましたが、並び順を保存できませんでした。${orderError.message}`
        : "分類は変更しましたが、並び順を保存できませんでした。");
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
    event: BookPointerEvent,
    endReason: "release" | "cancel",
  ) {
    const pointerStart = bookPointerStartRef.current;
    if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;
    clearLongPressTimer();
    stopBookAutoScroll();
    bookPointerStartRef.current = null;
    bookDragListenersCleanupRef.current?.();

    const draggedId = draggingBookIdRef.current;
    if (!draggedId) return;
    const finalDropTarget = endReason === "release"
      ? resolveBookDropTarget(event.clientX, event.clientY, draggedId)
      : null;
    const dropTarget = resolveCompletedDropTarget(
      finalDropTarget,
      bookDropTargetRef.current,
      endReason,
    );
    const shouldDelete = dropTarget?.type === "delete";
    const targetCategory = dropTarget?.type === "category" ? dropTarget.category : null;
    const targetBookId = dropTarget?.type === "category" ? dropTarget.bookId : null;
    const shouldFinishDrag = endReason === "release" && dragMovedRef.current;
    draggingBookIdRef.current = null;
    dragOriginRef.current = null;
    dragMovedRef.current = false;
    bookDropTargetRef.current = null;
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
      void classifyDraggedBook(draggedId, targetCategory, targetBookId);
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

  function renderBookCard(book: Book, index: number) {
    const compact = bookDisplayDensity === "compact";
    return (
      <button
        className={[
          "book-card",
          compact ? "is-compact" : "",
          book.id === selectedBookId ? "is-selected" : "",
          book.id === draggingBookId ? "is-dragging" : "",
        ].filter(Boolean).join(" ")}
        type="button"
        key={book.id}
        data-book-id={book.id}
        aria-pressed={book.id === selectedBookId}
        onClick={() => openBook(book)}
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) => startBookPress(event, book.id)}
        onPointerMove={moveBook}
        onPointerUp={(event) => finishBookPress(event, "release")}
        onPointerCancel={(event) => finishBookPress(event, "cancel")}
      >
        <span className="cover-wrap">
          <img
            src={book.coverUrl}
            alt={`${book.title}の表紙`}
            loading={index > 5 ? "lazy" : "eager"}
            draggable={false}
          />
        </span>
        {compact ? (
          <span className="book-card-copy">
            <strong>{book.title}</strong>
            <small>{book.author || "著者名未登録"}</small>
            <small>{book.publisher || "出版社名未登録"}</small>
          </span>
        ) : (
          <>
            <strong>{book.title}</strong>
            <small>{formatDate(book.createdAt)}</small>
          </>
        )}
      </button>
    );
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

  async function copyTitleAnalysisPrompt() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("先にタイトルを入力してください。");
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setError("この端末またはブラウザは文章のコピーに対応していません。");
      return;
    }
    try {
      await navigator.clipboard.writeText(createTitleAnalysisPrompt(trimmedTitle));
      setTitlePromptCopied(true);
      setError("");
    } catch {
      setError("分析用の文章をコピーできませんでした。もう一度お試しください。");
    }
  }

  async function shareTitleAnalysisPrompt() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("先にタイトルを入力してください。");
      return;
    }
    if (!navigator.share) {
      setError("この端末またはブラウザは共有に対応していません。分析用の文章をコピーしてお使いください。");
      return;
    }

    setTitleSharing(true);
    setError("");
    try {
      await navigator.share({
        title: `${trimmedTitle}を調べる`,
        text: createTitleAnalysisPrompt(trimmedTitle),
      });
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      setError("分析用の文章を共有できませんでした。もう一度お試しください。");
    } finally {
      setTitleSharing(false);
    }
  }

  async function pasteCoverFromClipboard() {
    if (!navigator.clipboard?.read) {
      setError("この端末またはブラウザは画像の貼り付けに対応していません。");
      return;
    }

    setPastingCover(true);
    setError("");
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const image = await item.getType(imageType);
        const applied = await applyPhoto(image);
        if (applied) {
          setCropMessage("貼り付けた表紙画像を読み込みました。必要なら白い枠を調整してください。");
        }
        return;
      }
      setError("コピーされた画像がありません。表紙画像をコピーしてからお試しください。");
    } catch (clipboardError) {
      if (clipboardError instanceof DOMException && clipboardError.name === "NotAllowedError") {
        setError("クリップボードの読み取りが許可されませんでした。貼り付けを許可してもう一度お試しください。");
      } else {
        setError("表紙画像を貼り付けられませんでした。画像をコピーしてからもう一度お試しください。");
      }
    } finally {
      setPastingCover(false);
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
        author: author.trim(),
        publisher: publisher.trim(),
        notes: notes.trim(),
        isbn,
      };
      const storedBook = editingBookId
        ? await updateBook({ id: editingBookId, ...values })
        : await addBook({ ...values, category: registrationCategory });
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

  function openSettingsDialog() {
    setPendingRestore(null);
    setSettingsMessage("");
    setSettingsError(false);
    settingsDialogRef.current?.showModal();
  }

  function selectBookViewMode(mode: BookViewMode) {
    setBookViewMode(mode);
    clearBookSelection();
    try {
      window.localStorage.setItem(bookViewModeStorageKey, mode);
    } catch {
      setSettingsError(true);
      setSettingsMessage("表示方法をこの端末に保存できませんでした。");
    }
  }

  function selectBookDisplayDensity(density: BookDisplayDensity) {
    setBookDisplayDensity(density);
    clearBookSelection();
    try {
      window.localStorage.setItem(bookDisplayDensityStorageKey, density);
    } catch {
      setSettingsError(true);
      setSettingsMessage("一覧の大きさをこの端末に保存できませんでした。");
    }
  }

  function closeSettingsDialog() {
    if (backupBusy || restoreBusy) return;
    setPendingRestore(null);
    setSettingsMessage("");
    setSettingsError(false);
    settingsDialogRef.current?.close();
  }

  async function downloadCompleteBackup() {
    setBackupBusy(true);
    setSettingsMessage("画像を含む完全バックアップを作成しています…");
    setSettingsError(false);
    try {
      const storedBooks = await getBooks();
      const createdAt = new Date().toISOString();
      const backup = await createCompleteBackup(storedBooks, createdAt);
      const date = createdAt.slice(0, 10).replaceAll("-", "");
      const url = URL.createObjectURL(backup);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tsundoku-dial-backup-${date}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setSettingsMessage(`${storedBooks.length}冊とすべての画像をバックアップしました。ダウンロード先を確認してください。`);
    } catch (backupError) {
      setSettingsError(true);
      setSettingsMessage(backupError instanceof Error ? backupError.message : "バックアップを作成できませんでした。");
    } finally {
      setBackupBusy(false);
    }
  }

  async function selectRestoreFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setRestoreBusy(true);
    setPendingRestore(null);
    setSettingsMessage("バックアップの内容と画像を確認しています…");
    setSettingsError(false);
    try {
      const parsed = await parseCompleteBackup(file);
      setPendingRestore(parsed);
      setSettingsMessage("検証が完了しました。内容を確認して復元してください。");
    } catch (restoreError) {
      setSettingsError(true);
      setSettingsMessage(restoreError instanceof Error ? restoreError.message : "バックアップを読み取れませんでした。");
    } finally {
      setRestoreBusy(false);
    }
  }

  async function restoreCompleteBackup() {
    if (!pendingRestore) return;
    const confirmed = window.confirm(
      `現在の本棚${books.length}冊を、バックアップの${pendingRestore.books.length}冊で置き換えます。よろしいですか？`,
    );
    if (!confirmed) return;

    setRestoreBusy(true);
    setSettingsMessage("本棚を復元しています…");
    setSettingsError(false);
    try {
      await replaceBooks(pendingRestore.books);
      coverUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      coverUrlsRef.current = [];
      const nextBooks = pendingRestore.books.map((book) => {
        const coverUrl = URL.createObjectURL(book.cover);
        coverUrlsRef.current.push(coverUrl);
        return { ...book, coverUrl };
      });
      booksRef.current = nextBooks;
      setBooks(nextBooks);
      setSelectedBook(null);
      setSelectedBookId(null);
      setError("");
      setPendingRestore(null);
      setSettingsMessage(`${nextBooks.length}冊を復元しました。`);
    } catch (restoreError) {
      setSettingsError(true);
      setSettingsMessage(restoreError instanceof Error ? restoreError.message : "本棚を復元できませんでした。");
    } finally {
      setRestoreBusy(false);
    }
  }

  return (
    <main>
      <header className="topbar" id="top">
        <a className="brand" href="#top" aria-label="積読ダイヤル ホーム">
          <span className="brand-mark" aria-hidden="true">本</span>
          <span>積読ダイヤル</span>
        </a>
        <div className="topbar-actions">
          <button
            className="add-button"
            type="button"
            aria-haspopup="dialog"
            onClick={() => openAddDialog(activeCategory)}
          >
            <span aria-hidden="true">＋</span> 本を登録する
          </button>
          <button
            className="settings-button"
            type="button"
            aria-haspopup="dialog"
            onClick={openSettingsDialog}
          >
            <span aria-hidden="true">⚙</span> 設定
          </button>
        </div>
      </header>

      {bookViewMode === "dial" && (
        <section className="category-console" aria-labelledby="category-panel-title">
          <div className="console-nameplate">
            <span aria-hidden="true" />
            <h1 id="category-panel-title">本の分類</h1>
            <span aria-hidden="true" />
          </div>
          <div className="category-zone-panel" data-book-drop-container>
            {bookCategories.map((category) => (
              <button
                className={[
                  "category-zone",
                  activeCategory === category.id ? "is-selected" : "",
                  categoryDropActive === category.id ? "is-drop-active" : "",
                ].filter(Boolean).join(" ")}
                type="button"
                key={category.id}
                data-book-drop="category"
                data-category-drop={category.id}
                aria-pressed={activeCategory === category.id}
                onClick={() => handleCategoryClick(category.id)}
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={(event) => startCategoryRegistrationPress(event, category.id)}
                onPointerMove={moveCategoryRegistrationPress}
                onPointerUp={finishCategoryRegistrationPress}
                onPointerCancel={finishCategoryRegistrationPress}
                onLostPointerCapture={finishCategoryRegistrationPress}
              >
                <span>{category.label}</span>
                <small>{books.filter((book) => getBookCategory(book) === category.id).length}冊</small>
              </button>
            ))}
            <div
              className={deleteDropActive ? "category-delete-zone is-drop-active" : "category-delete-zone"}
              data-book-drop="delete"
              aria-label="ここへ本をドロップして削除"
            >
              <span aria-hidden="true">×</span>
              <strong>{deleteDropActive ? "ここで離して削除" : "削除"}</strong>
            </div>
          </div>
          <p className="category-counter" aria-live="polite">
            <span aria-hidden="true" />
            {activeCategory === "unclassified" ? "積読・未分類" : activeCategoryOption.label}
            <strong>{visibleBooks.length}冊</strong>
            <span aria-hidden="true" />
          </p>
          <p className="category-panel-help">分類をタップして表示、長押しでその分類に本を登録。本をドラッグして分類・削除できます</p>
        </section>
      )}

      <section className="shelf" aria-labelledby="shelf-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">BOOKSHELF</p>
            <h2 id="shelf-title">わたしの本棚</h2>
          </div>
          <div className="shelf-actions">
            <p>{bookViewMode === "shelf" ? "分類名を長押しして本を登録。ドラッグで並び替え・分類・削除" : "ドラッグで並び替え・分類・削除（タッチは長押し）"}</p>
            {bookViewMode === "shelf" && (
              <div
                className={deleteDropActive ? "shelf-trash-target is-drop-active" : "shelf-trash-target"}
                data-book-drop="delete"
                data-book-drop-container
                aria-label="ここへ本をドロップして削除"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" />
                </svg>
                <span>{deleteDropActive ? "ここで離して削除" : "削除"}</span>
              </div>
            )}
          </div>
        </div>

        {classificationMessage && (
          <p className="classification-message" role="status">{classificationMessage}</p>
        )}
        {error && <p className="error-message" role="alert">{error}</p>}
        {loading ? (
          <div className="loading" aria-live="polite">本棚をひらいています…</div>
        ) : bookViewMode === "shelf" ? (
          <div className="bookshelf-categories" data-book-drop-container>
            {shelfCategoryOrder.map((category) => {
              const categoryOption = bookCategories.find((item) => item.id === category);
              const categoryBooks = books.filter(
                (book) => getBookCategory(book) === category,
              );
              return (
                <section
                  className={categoryDropActive === category ? "bookshelf-category is-drop-active" : "bookshelf-category"}
                  key={category}
                  data-book-drop="category"
                  data-category-drop={category}
                  data-category-row={category}
                  aria-labelledby={`bookshelf-category-${category}`}
                >
                  <div className="bookshelf-category-heading">
                    <h3
                      id={`bookshelf-category-${category}`}
                      onContextMenu={(event) => event.preventDefault()}
                      onPointerDown={(event) => startCategoryRegistrationPress(event, category)}
                      onPointerMove={moveCategoryRegistrationPress}
                      onPointerUp={finishCategoryRegistrationPress}
                      onPointerCancel={finishCategoryRegistrationPress}
                      onLostPointerCapture={finishCategoryRegistrationPress}
                    >
                      {categoryOption?.label ?? category}
                    </h3>
                    <span>{categoryBooks.length}冊</span>
                  </div>
                  <div className={bookDisplayDensity === "compact" ? "bookshelf-list" : "bookshelf-row-scroll"}>
                    {categoryBooks.length > 0 ? (
                      <div className={bookDisplayDensity === "compact" ? "book-list" : "bookshelf-row"}>
                        {categoryBooks.map(renderBookCard)}
                      </div>
                    ) : (
                      <p className="bookshelf-row-empty">この分類には、まだ本がありません</p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        ) : books.length === 0 ? (
          <div className="empty-state">
            <div className="empty-books" aria-hidden="true"><i /><i /><i /></div>
            <h3>最初の一冊を積んでみましょう</h3>
            <p>上の分類を長押しして、本の登録を始めてください。</p>
          </div>
        ) : visibleBooks.length === 0 ? (
          <div className="category-empty">
            <h3>この分類には、まだ本がありません</h3>
            <p>上の分類をタップして表示を切り替え、本をドラッグして分類してください。</p>
          </div>
        ) : (
          <div className={bookDisplayDensity === "compact" ? "book-list" : "book-grid"}>
            {visibleBooks.map(renderBookCard)}
          </div>
        )}
        {selectedBookId && !draggingBookId && (
          <p className="book-selection-hint" role="status">
            つかみました。もう一度動かすと並べ替え・分類・削除できます。空いている場所をタップすると解除します。
          </p>
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

      <dialog
        className="settings-dialog"
        ref={settingsDialogRef}
        onCancel={(event) => {
          if (backupBusy || restoreBusy) event.preventDefault();
        }}
        onClose={() => {
          setPendingRestore(null);
          setSettingsMessage("");
          setSettingsError(false);
        }}
      >
        <section className="settings-card" aria-labelledby="settings-title">
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">SETTINGS</p>
              <h2 id="settings-title">設定</h2>
            </div>
            <button
              className="close-button"
              type="button"
              onClick={closeSettingsDialog}
              aria-label="設定を閉じる"
              disabled={backupBusy || restoreBusy}
            >
              ×
            </button>
          </div>

          <section className="settings-section" aria-labelledby="view-mode-title">
            <h3 id="view-mode-title">本の表示方法</h3>
            <p>分類を1つずつ表示する分類表示と、すべての分類を見渡せる棚一覧表示を選べます。</p>
            <fieldset className="view-mode-options">
              <legend className="visually-hidden">本の表示方法</legend>
              <label htmlFor="book-view-mode-dial" aria-label="分類表示">
                <input
                  id="book-view-mode-dial"
                  type="radio"
                  name="book-view-mode"
                  value="dial"
                  checked={bookViewMode === "dial"}
                  onChange={() => selectBookViewMode("dial")}
                />
                <span><strong>分類表示</strong><small>分類を1つずつ表示</small></span>
              </label>
              <label htmlFor="book-view-mode-shelf" aria-label="棚一覧表示">
                <input
                  id="book-view-mode-shelf"
                  type="radio"
                  name="book-view-mode"
                  value="shelf"
                  checked={bookViewMode === "shelf"}
                  onChange={() => selectBookViewMode("shelf")}
                />
                <span><strong>棚一覧表示</strong><small>すべての分類を一覧表示</small></span>
              </label>
            </fieldset>
            <h4>一覧の大きさ</h4>
            <p>通常の表紙表示と、スマートフォンで約7冊を見渡せるコンパクト一覧を選べます。</p>
            <fieldset className="view-mode-options">
              <legend className="visually-hidden">一覧の大きさ</legend>
              <label htmlFor="book-display-density-covers" aria-label="通常表示">
                <input
                  id="book-display-density-covers"
                  type="radio"
                  name="book-display-density"
                  value="covers"
                  checked={bookDisplayDensity === "covers"}
                  onChange={() => selectBookDisplayDensity("covers")}
                />
                <span><strong>通常表示</strong><small>表紙を大きく表示</small></span>
              </label>
              <label htmlFor="book-display-density-compact" aria-label="コンパクト一覧">
                <input
                  id="book-display-density-compact"
                  type="radio"
                  name="book-display-density"
                  value="compact"
                  checked={bookDisplayDensity === "compact"}
                  onChange={() => selectBookDisplayDensity("compact")}
                />
                <span><strong>コンパクト一覧</strong><small>表紙・タイトル・著者名・出版社名</small></span>
              </label>
            </fieldset>
          </section>

          <section className="settings-section" aria-labelledby="backup-title">
            <h3 id="backup-title">完全バックアップ</h3>
            <p>タイトル、著者名、出版社名、メモ、ISBN、分類、並び順、表紙画像、元画像、切り取り範囲を1つのファイルに保存します。</p>
            <button
              className="backup-button"
              type="button"
              onClick={() => void downloadCompleteBackup()}
              disabled={backupBusy || restoreBusy}
            >
              {backupBusy ? "バックアップを作成中…" : `完全バックアップを作成（${books.length}冊）`}
            </button>
          </section>

          <section className="settings-section restore-section" aria-labelledby="restore-title">
            <h3 id="restore-title">バックアップから復元</h3>
            <p>ファイルを検証してから、現在の本棚をバックアップの内容で置き換えます。</p>
            <label className={backupBusy || restoreBusy ? "restore-file-button is-disabled" : "restore-file-button"}>
              {restoreBusy ? "ファイルを確認中…" : "バックアップファイルを選ぶ"}
              <input
                className="restore-file-input"
                type="file"
                accept=".json,application/json"
                onChange={(event) => void selectRestoreFile(event)}
                disabled={backupBusy || restoreBusy}
              />
            </label>
            {pendingRestore && (
              <div className="restore-preview" role="status">
                <dl>
                  <div><dt>作成日時</dt><dd>{new Intl.DateTimeFormat("ja-JP", { dateStyle: "long", timeStyle: "short" }).format(new Date(pendingRestore.createdAt))}</dd></div>
                  <div><dt>復元する本</dt><dd>{pendingRestore.books.length}冊</dd></div>
                  <div><dt>現在の本棚</dt><dd>{books.length}冊</dd></div>
                </dl>
                <button className="restore-button" type="button" onClick={() => void restoreCompleteBackup()} disabled={restoreBusy}>
                  現在の本棚を置き換えて復元
                </button>
              </div>
            )}
          </section>

          {settingsMessage && (
            <p className={settingsError ? "settings-message is-error" : "settings-message"} role={settingsError ? "alert" : "status"}>
              {settingsMessage}
            </p>
          )}
        </section>
      </dialog>

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
              {!editingBookId && (
                <p className="registration-category">登録先：{registrationCategoryOption.label}</p>
              )}
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
              setTitlePromptCopied(false);
              setDuplicateConfirmed(false);
            }} placeholder="あとからでも入力できます" maxLength={160} /></label>
            <div className="title-analysis-panel">
              <button
                className="copy-prompt-button"
                type="button"
                onClick={() => void copyTitleAnalysisPrompt()}
                disabled={!title.trim()}
              >
                {titlePromptCopied ? "コピーしました" : "分析用の文章をコピー"}
              </button>
              <small>入力したタイトルから、正式タイトル・著者名・出版社名・本の要約・表紙画像をChatGPTで調べます。</small>
              <button
                className="share-button"
                type="button"
                onClick={() => void shareTitleAnalysisPrompt()}
                disabled={!title.trim() || titleSharing}
              >
                {titleSharing ? "共有画面を開いています…" : "ChatGPTで検索"}
              </button>
              <small>共有先でChatGPTを選んでください。</small>
              <button
                className="paste-cover-button"
                type="button"
                onClick={() => void pasteCoverFromClipboard()}
                disabled={detecting || pastingCover}
              >
                {pastingCover ? "表紙画像を貼り付けています…" : "表紙画像を貼り付ける"}
              </button>
              <small>ChatGPTなどでコピーした画像を表紙として読み込みます。</small>
            </div>
            <label><span>著者名 <small>任意</small></span><input value={author} onChange={(event) => {
              authorRef.current = event.target.value;
              setAuthor(event.target.value);
            }} placeholder="ISBNから自動入力、または手入力" maxLength={240} /></label>
            <label><span>出版社名 <small>任意</small></span><input value={publisher} onChange={(event) => {
              publisherRef.current = event.target.value;
              setPublisher(event.target.value);
            }} placeholder="ISBNから自動入力、または手入力" maxLength={160} /></label>
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
              <dl>
                {selectedBook.author && <div><dt>著者名</dt><dd>{selectedBook.author}</dd></div>}
                {selectedBook.publisher && <div><dt>出版社名</dt><dd>{selectedBook.publisher}</dd></div>}
                <div><dt>積んだ日</dt><dd>{formatDate(selectedBook.createdAt)}</dd></div>
              </dl>
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
