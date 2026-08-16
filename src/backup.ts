import type { Crop } from "./image";
import type { BookCategory, StoredBook } from "./storage";

const BACKUP_FORMAT = "tsundoku-dial-backup";
const BACKUP_VERSION = 1;
const MAX_BOOKS = 10_000;
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
const categories: BookCategory[] = ["unclassified", "reading", "reread", "owned", "read"];

type BackupImage = {
  type: string;
  size: number;
  sha256: string;
  base64: string;
};

type BackupBook = Omit<StoredBook, "cover" | "original"> & {
  cover: BackupImage;
  original?: BackupImage;
};

type BackupDocument = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  bookCount: number;
  books: BackupBook[];
};

export type ParsedBackup = {
  createdAt: string;
  books: StoredBook[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("バックアップ内の画像データが壊れています。");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function sha256(bytes: Uint8Array) {
  const digestBytes = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestBytes.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function encodeImage(image: Blob): Promise<BackupImage> {
  const bytes = new Uint8Array(await image.arrayBuffer());
  return {
    type: image.type || "application/octet-stream",
    size: image.size,
    sha256: await sha256(bytes),
    base64: bytesToBase64(bytes),
  };
}

export async function createCompleteBackup(books: StoredBook[], createdAt = new Date().toISOString()) {
  if (books.length > MAX_BOOKS) {
    throw new Error("バックアップできる書籍数を超えています。");
  }
  const backupBooks: BackupBook[] = [];
  for (const book of books) {
    backupBooks.push({
      id: book.id,
      title: book.title,
      notes: book.notes,
      isbn: book.isbn,
      createdAt: book.createdAt,
      sortOrder: book.sortOrder,
      category: book.category,
      cover: await encodeImage(book.cover),
      original: book.original ? await encodeImage(book.original) : undefined,
      crop: book.crop,
    });
  }

  const backup: BackupDocument = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    bookCount: backupBooks.length,
    books: backupBooks,
  };
  const file = new Blob([JSON.stringify(backup)], { type: "application/json" });
  if (file.size > MAX_BACKUP_BYTES) {
    throw new Error("バックアップファイルが大きすぎます。");
  }
  return file;
}

function requireString(value: unknown, label: string, maximumLength: number) {
  if (typeof value !== "string" || value.length > maximumLength) {
    throw new Error(`${label}が正しくありません。`);
  }
  return value;
}

function validateCrop(value: unknown): Crop | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("切り取り情報が正しくありません。");
  const coordinates = [value.left, value.top, value.right, value.bottom];
  if (
    !coordinates.every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 100)
  ) {
    throw new Error("切り取り情報が正しくありません。");
  }
  const [left, top, right, bottom] = coordinates as number[];
  if (!(left < right && top < bottom)) throw new Error("切り取り情報が正しくありません。");
  return { left, top, right, bottom };
}

async function decodeImage(value: unknown) {
  if (!isRecord(value)) throw new Error("画像情報が正しくありません。");
  const type = requireString(value.type, "画像形式", 100);
  if (!/^image\/(?:jpeg|png|webp)$/.test(type)) {
    throw new Error("対応していない画像形式が含まれています。");
  }
  const expectedHash = requireString(value.sha256, "画像の検証情報", 64);
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) throw new Error("画像の検証情報が正しくありません。");
  if (typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0) {
    throw new Error("画像サイズが正しくありません。");
  }
  const encoded = requireString(value.base64, "画像データ", MAX_BACKUP_BYTES * 2);
  const bytes = base64ToBytes(encoded);
  if (bytes.byteLength !== value.size || await sha256(bytes) !== expectedHash) {
    throw new Error("バックアップ内の画像が壊れています。");
  }
  return new Blob([bytes], { type });
}

async function parseBook(value: unknown): Promise<StoredBook> {
  if (!isRecord(value)) throw new Error("書籍データが正しくありません。");
  const id = requireString(value.id, "書籍ID", 200);
  if (!id) throw new Error("書籍IDが正しくありません。");
  const title = requireString(value.title, "タイトル", 160);
  const notes = requireString(value.notes, "メモ", 1_000);
  const createdAt = requireString(value.createdAt, "登録日時", 50);
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("登録日時が正しくありません。");
  if (value.isbn !== null && typeof value.isbn !== "string") throw new Error("ISBNが正しくありません。");
  if (typeof value.isbn === "string" && value.isbn.length > 32) throw new Error("ISBNが正しくありません。");
  if (value.sortOrder !== undefined && (typeof value.sortOrder !== "number" || !Number.isFinite(value.sortOrder))) {
    throw new Error("並び順が正しくありません。");
  }
  if (value.category !== undefined && !categories.includes(value.category as BookCategory)) {
    throw new Error("分類が正しくありません。");
  }

  return {
    id,
    title,
    notes,
    isbn: value.isbn as string | null,
    createdAt,
    sortOrder: value.sortOrder as number | undefined,
    category: value.category as BookCategory | undefined,
    cover: await decodeImage(value.cover),
    original: value.original === undefined ? undefined : await decodeImage(value.original),
    crop: validateCrop(value.crop),
  };
}

export async function parseCompleteBackup(file: Blob): Promise<ParsedBackup> {
  if (file.size > MAX_BACKUP_BYTES) {
    throw new Error("バックアップファイルが大きすぎます。");
  }

  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error("バックアップファイルを読み取れませんでした。");
  }
  if (!isRecord(value) || value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION) {
    throw new Error("このアプリの対応するバックアップファイルではありません。");
  }
  const createdAt = requireString(value.createdAt, "バックアップ作成日時", 50);
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("バックアップ作成日時が正しくありません。");
  if (!Array.isArray(value.books) || value.books.length > MAX_BOOKS || value.bookCount !== value.books.length) {
    throw new Error("バックアップの書籍数が正しくありません。");
  }

  const books: StoredBook[] = [];
  const ids = new Set<string>();
  for (const item of value.books) {
    const book = await parseBook(item);
    if (ids.has(book.id)) throw new Error("同じ書籍IDが重複しています。");
    ids.add(book.id);
    books.push(book);
  }
  return { createdAt, books };
}
