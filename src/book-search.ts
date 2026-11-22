import type { StoredBook } from "./storage";

type SearchableBook = Pick<StoredBook, "title" | "author" | "publisher" | "notes" | "isbn">;

function normalizeSearchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP");
}

export function searchBooks<T extends SearchableBook>(books: T[], query: string): T[] {
  const keywords = normalizeSearchText(query).trim().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return [];

  return books.filter((book) => {
    const fields = [book.title, book.author, book.publisher, book.notes, book.isbn]
      .map((value) => normalizeSearchText(value ?? ""));
    return keywords.every((keyword) => fields.some((field) => field.includes(keyword)));
  });
}
