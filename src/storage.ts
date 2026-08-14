import type { Crop } from "./image";

export type StoredBook = {
  id: string;
  title: string;
  notes: string;
  isbn: string | null;
  createdAt: string;
  sortOrder?: number;
  cover: Blob;
  original?: Blob;
  crop?: Crop;
};

const DATABASE_NAME = "tsundoku-dial";
const DATABASE_VERSION = 1;
const BOOK_STORE = "books";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BOOK_STORE)) {
        const store = database.createObjectStore(BOOK_STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本棚を開けませんでした。"));
    request.onblocked = () => reject(new Error("別のタブを閉じてから、もう一度お試しください。"));
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本棚を操作できませんでした。"));
  });
}

export async function getBooks() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(BOOK_STORE, "readonly");
    const records = await requestResult(transaction.objectStore(BOOK_STORE).getAll() as IDBRequest<StoredBook[]>);
    return records.sort((left, right) => {
      const leftOrder = left.sortOrder ?? Date.parse(left.createdAt);
      const rightOrder = right.sortOrder ?? Date.parse(right.createdAt);
      return rightOrder - leftOrder;
    });
  } finally {
    database.close();
  }
}

export async function addBook(
  input: Pick<StoredBook, "title" | "notes" | "cover" | "original" | "crop">,
) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(BOOK_STORE, "readwrite");
    const store = transaction.objectStore(BOOK_STORE);
    const records = await requestResult(
      store.getAll() as IDBRequest<StoredBook[]>,
    );
    const highestOrder = records.reduce(
      (highest, record) =>
        Math.max(highest, record.sortOrder ?? Date.parse(record.createdAt)),
      Date.now(),
    );
    const book: StoredBook = {
      id: crypto.randomUUID(),
      title: input.title,
      notes: input.notes,
      isbn: null,
      createdAt: new Date().toISOString(),
      sortOrder: highestOrder + 1,
      cover: input.cover,
      original: input.original,
      crop: input.crop,
    };
    await requestResult(store.add(book));
    return book;
  } finally {
    database.close();
  }
}

export async function updateBook(
  input: Pick<StoredBook, "id" | "title" | "notes" | "cover" | "original" | "crop">,
) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(BOOK_STORE, "readwrite");
    const store = transaction.objectStore(BOOK_STORE);
    const current = await requestResult(
      store.get(input.id) as IDBRequest<StoredBook | undefined>,
    );
    if (!current) throw new Error("更新する本が見つかりませんでした。");

    const book: StoredBook = { ...current, ...input };
    await requestResult(store.put(book));
    return book;
  } finally {
    database.close();
  }
}

export async function saveBookOrder(bookIds: string[]) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(BOOK_STORE, "readwrite");
    const store = transaction.objectStore(BOOK_STORE);
    const records = await requestResult(
      store.getAll() as IDBRequest<StoredBook[]>,
    );
    const recordsById = new Map(records.map((book) => [book.id, book]));
    const highestOrder = records.reduce(
      (highest, record) =>
        Math.max(highest, record.sortOrder ?? Date.parse(record.createdAt)),
      Date.now(),
    );

    await Promise.all(bookIds.map((id, index) => {
      const book = recordsById.get(id);
      if (!book) return Promise.resolve();
      return requestResult(store.put({
        ...book,
        sortOrder: highestOrder + bookIds.length - index,
      }));
    }));
  } finally {
    database.close();
  }
}

export async function deleteBook(id: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(BOOK_STORE, "readwrite");
    await requestResult(transaction.objectStore(BOOK_STORE).delete(id));
  } finally {
    database.close();
  }
}
