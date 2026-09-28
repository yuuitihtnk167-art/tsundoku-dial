import { normalizeIsbn } from "./book-match";

export type BookImport = {
  title: string;
  author: string;
  publisher: string;
  notes: string;
  isbn: string | null;
};

export function parseBookImport(text: string): BookImport {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  const json = match ? match[1] : trimmed;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("本の情報を読み取れませんでした。ChatGPTのコードブロック内をコピーしてください。");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("本の情報の形式が正しくありません。");
  }

  const data = value as Record<string, unknown>;
  function readField(field: string, label: string, maxLength: number) {
    const fieldValue = data[field];
    if (typeof fieldValue !== "string" || fieldValue.trim().length > maxLength) {
      throw new Error(`「${label}」が入力欄に収まらないか、形式が正しくありません。`);
    }
    return fieldValue.trim();
  }
  const title = readField("title", "タイトル", 160);
  const author = readField("author", "著者名", 240);
  const publisher = readField("publisher", "出版社名", 160);
  const notes = readField("notes", "本の内容", 1000);
  if (!title) {
    throw new Error("タイトルが空です。本を特定できた結果をコピーしてください。");
  }
  if (data.isbn !== null && typeof data.isbn !== "string") {
    throw new Error("ISBNの形式が正しくありません。");
  }
  const isbn = data.isbn ? normalizeIsbn(data.isbn) : null;
  if (data.isbn && !isbn) {
    throw new Error("ISBNが正しくありません。ChatGPTの結果を確認してください。");
  }

  return {
    title,
    author,
    publisher,
    notes,
    isbn,
  };
}
