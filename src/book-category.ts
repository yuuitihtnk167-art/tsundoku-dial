import type { BookCategory, StoredBook } from "./storage";

export function isOwnedBook(book: Pick<StoredBook, "category" | "owned">) {
  return book.category === "owned" || book.owned === true;
}

export function canSetBookCategory(
  book: Pick<StoredBook, "category" | "owned">,
  category: BookCategory,
) {
  return !isOwnedBook(book) || category === "owned" || category === "reading";
}

export function bookCategoryChange(book: StoredBook, category: BookCategory) {
  if (!canSetBookCategory(book, category)) {
    throw new Error("持っている本の登録先は「持っている」または「今読んでいる」に限られます。");
  }
  return { category, owned: isOwnedBook(book) || category === "owned" };
}
