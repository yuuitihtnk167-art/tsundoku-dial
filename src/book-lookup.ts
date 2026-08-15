export type BookLookupResult = {
  title: string;
  cover: Blob | null;
};

type OpenBdResponse = Array<{
  summary?: {
    title?: unknown;
    cover?: unknown;
  };
} | null>;

const openBdEndpoint = "https://api.openbd.jp/v1/get";
const openLibraryCoverEndpoint = "https://covers.openlibrary.org/b/isbn";
const maximumCoverBytes = 10 * 1024 * 1024;

function secureImageUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function fetchCover(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal, credentials: "omit" });
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLocaleLowerCase().startsWith("image/")) return null;
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumCoverBytes) return null;
  const cover = await response.blob();
  return cover.size > 0 && cover.size <= maximumCoverBytes ? cover : null;
}

export async function lookupBookByIsbn(
  isbn: string,
  signal?: AbortSignal,
): Promise<BookLookupResult> {
  let title = "";
  const coverCandidates: string[] = [];

  try {
    const response = await fetch(`${openBdEndpoint}?isbn=${encodeURIComponent(isbn)}`, {
      signal,
      credentials: "omit",
    });
    if (response.ok) {
      const books = await response.json() as OpenBdResponse;
      const summary = books[0]?.summary;
      if (typeof summary?.title === "string") title = summary.title.trim().slice(0, 160);
      const openBdCover = secureImageUrl(summary?.cover);
      if (openBdCover) coverCandidates.push(openBdCover);
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }

  coverCandidates.push(
    `${openLibraryCoverEndpoint}/${encodeURIComponent(isbn)}-L.jpg?default=false`,
  );
  for (const coverUrl of coverCandidates) {
    try {
      const cover = await fetchCover(coverUrl, signal);
      if (cover) return { title, cover };
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }

  return { title, cover: null };
}
