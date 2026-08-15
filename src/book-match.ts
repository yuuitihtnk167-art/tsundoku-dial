export type TitleMatch = "exact" | "similar";

const unsetTitle = "タイトル未設定";

export function normalizeIsbn(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!/^97[89]\d{10}$/.test(digits) || digits.startsWith("9790")) return null;

  const sum = digits
    .slice(0, 12)
    .split("")
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === Number(digits[12]) ? digits : null;
}

export function normalizeTitle(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}]+/gu, "");
}

function bigramCounts(value: string) {
  const counts = new Map<string, number>();
  for (let index = 0; index < value.length - 1; index += 1) {
    const bigram = value.slice(index, index + 2);
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }
  return counts;
}

function titleSimilarity(left: string, right: string) {
  const leftCounts = bigramCounts(left);
  const rightCounts = bigramCounts(right);
  let overlap = 0;
  leftCounts.forEach((count, bigram) => {
    overlap += Math.min(count, rightCounts.get(bigram) ?? 0);
  });
  return (2 * overlap) / (left.length - 1 + right.length - 1);
}

export function getTitleMatch(left: string, right: string): TitleMatch | null {
  const normalizedLeft = normalizeTitle(left);
  const normalizedRight = normalizeTitle(right);
  const normalizedUnsetTitle = normalizeTitle(unsetTitle);
  if (
    !normalizedLeft ||
    !normalizedRight ||
    normalizedLeft === normalizedUnsetTitle ||
    normalizedRight === normalizedUnsetTitle
  ) {
    return null;
  }
  if (normalizedLeft === normalizedRight) return "exact";
  if (Math.min(normalizedLeft.length, normalizedRight.length) < 4) return null;
  return titleSimilarity(normalizedLeft, normalizedRight) >= 0.78 ? "similar" : null;
}
