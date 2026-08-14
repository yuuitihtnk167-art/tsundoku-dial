export type Crop = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export const initialCrop: Crop = { left: 4, top: 4, right: 96, bottom: 96 };
export const fullCrop: Crop = { left: 0, top: 0, right: 100, bottom: 100 };

const MAX_ORIGINAL_EDGE = 2200;
const MAX_ANALYSIS_EDGE = 520;

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("画像を保存できませんでした。")),
      "image/jpeg",
      quality,
    );
  });
}

export async function normalizePhoto(source: Blob) {
  const image = await createImageBitmap(source);
  try {
    const scale = Math.min(1, MAX_ORIGINAL_EDGE / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像を処理できませんでした。");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas, 0.9);
  } finally {
    image.close();
  }
}

function colorDistanceSquared(
  red: number,
  green: number,
  blue: number,
  background: readonly number[],
) {
  const redDelta = red - background[0];
  const greenDelta = green - background[1];
  const blueDelta = blue - background[2];
  return redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta;
}

function sampleCornerColors(data: Uint8ClampedArray, width: number, height: number) {
  const sampleWidth = Math.max(3, Math.round(width * 0.04));
  const sampleHeight = Math.max(3, Math.round(height * 0.04));
  const corners = [
    [0, 0],
    [width - sampleWidth, 0],
    [0, height - sampleHeight],
    [width - sampleWidth, height - sampleHeight],
  ];

  return corners.map(([startX, startY]) => {
    const totals = [0, 0, 0];
    let samples = 0;
    for (let y = startY; y < startY + sampleHeight; y += 2) {
      for (let x = startX; x < startX + sampleWidth; x += 2) {
        const index = (y * width + x) * 4;
        totals[0] += data[index];
        totals[1] += data[index + 1];
        totals[2] += data[index + 2];
        samples += 1;
      }
    }
    return totals.map((total) => total / samples);
  });
}

function smoothScores(scores: number[]) {
  return scores.map((_, index) => {
    let total = 0;
    let samples = 0;
    for (let offset = -2; offset <= 2; offset += 1) {
      const value = scores[index + offset];
      if (value === undefined) continue;
      total += value;
      samples += 1;
    }
    return total / samples;
  });
}

function projectedBounds(scores: number[], perpendicularSize: number) {
  const smoothed = smoothScores(scores);
  const threshold = Math.max(3, perpendicularSize * 0.055);
  const edgeMargin = Math.max(1, Math.round(scores.length * 0.015));
  let start = -1;
  let end = -1;

  for (let index = edgeMargin; index < scores.length - edgeMargin; index += 1) {
    if (smoothed[index] < threshold) continue;
    if (start === -1) start = index;
    end = index;
  }

  return start === -1 ? null : { start, end };
}

function detectBounds(data: Uint8ClampedArray, width: number, height: number) {
  const backgrounds = sampleCornerColors(data, width, height);
  const columns = Array.from({ length: width }, () => 0);
  const rows = Array.from({ length: height }, () => 0);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const backgroundDistance = Math.min(
        ...backgrounds.map((background) =>
          colorDistanceSquared(red, green, blue, background),
        ),
      );
      const leftIndex = index - 4;
      const rightIndex = index + 4;
      const topIndex = index - width * 4;
      const bottomIndex = index + width * 4;
      const horizontalEdge =
        Math.abs(data[rightIndex] - data[leftIndex]) +
        Math.abs(data[rightIndex + 1] - data[leftIndex + 1]) +
        Math.abs(data[rightIndex + 2] - data[leftIndex + 2]);
      const verticalEdge =
        Math.abs(data[bottomIndex] - data[topIndex]) +
        Math.abs(data[bottomIndex + 1] - data[topIndex + 1]) +
        Math.abs(data[bottomIndex + 2] - data[topIndex + 2]);

      if (backgroundDistance > 1800 || horizontalEdge + verticalEdge > 150) {
        columns[x] += 1;
        rows[y] += 1;
      }
    }
  }

  const horizontal = projectedBounds(columns, height);
  const vertical = projectedBounds(rows, width);
  if (!horizontal || !vertical) return null;

  const paddingX = Math.round(width * 0.012);
  const paddingY = Math.round(height * 0.012);
  const left = Math.max(0, horizontal.start - paddingX);
  const right = Math.min(width, horizontal.end + paddingX + 1);
  const top = Math.max(0, vertical.start - paddingY);
  const bottom = Math.min(height, vertical.end + paddingY + 1);
  const widthRatio = (right - left) / width;
  const heightRatio = (bottom - top) / height;

  if (widthRatio < 0.28 || heightRatio < 0.28) return null;
  return {
    left: Number(((left / width) * 100).toFixed(1)),
    top: Number(((top / height) * 100).toFixed(1)),
    right: Number(((right / width) * 100).toFixed(1)),
    bottom: Number(((bottom / height) * 100).toFixed(1)),
  };
}

export async function detectBookCrop(source: Blob) {
  const image = await createImageBitmap(source);
  try {
    const scale = Math.min(1, MAX_ANALYSIS_EDGE / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("画像を解析できませんでした。");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const detectedCrop = detectBounds(imageData.data, canvas.width, canvas.height);
    return {
      crop: detectedCrop ?? initialCrop,
      detected: detectedCrop !== null,
    };
  } finally {
    image.close();
  }
}

export async function cropPhoto(source: Blob, crop: Crop) {
  const image = await createImageBitmap(source);
  try {
    const sx = Math.round((crop.left / 100) * image.width);
    const sy = Math.round((crop.top / 100) * image.height);
    const sourceWidth = Math.max(
      1,
      Math.round(((crop.right - crop.left) / 100) * image.width),
    );
    const sourceHeight = Math.max(
      1,
      Math.round(((crop.bottom - crop.top) / 100) * image.height),
    );
    const scale = Math.min(1, 1400 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像を処理できませんでした。");
    context.drawImage(
      image,
      sx,
      sy,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return await canvasToBlob(canvas, 0.88);
  } finally {
    image.close();
  }
}
