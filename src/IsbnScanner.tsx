import { useCallback, useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { normalizeIsbn } from "./book-match";

type IsbnScannerProps = {
  isbn: string | null;
  onIsbnChange: (isbn: string | null) => void;
};

const scanTimeoutMilliseconds = 15_000;

export function IsbnScanner({ isbn, onIsbnChange }: IsbnScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState(isbn ? "ISBNを記録しています。" : "");
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const nonIsbnSeenRef = useRef(false);

  const stopScan = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!scanning) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    nonIsbnSeenRef.current = false;
    setMessage("裏表紙のISBNバーコードを枠内に入れてください。");

    timeoutRef.current = window.setTimeout(() => {
      if (cancelled) return;
      setMessage(
        nonIsbnSeenRef.current
          ? "ISBN以外のバーコードを検出しました。978または979から始まるISBNを読み取ってください。"
          : "ISBNを読み取れませんでした。バーコード全体を枠内に入れて、もう一度お試しください。",
      );
      stopScan();
      setScanning(false);
    }, scanTimeoutMilliseconds);

    void (async () => {
      try {
        const { BarcodeFormat, BrowserMultiFormatOneDReader } = await import("@zxing/browser");
        if (cancelled) return;

        const reader = new BrowserMultiFormatOneDReader(undefined, {
          delayBetweenScanAttempts: 180,
          delayBetweenScanSuccess: 500,
        });
        reader.possibleFormats = [BarcodeFormat.EAN_13];
        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          video,
          (result, _error, activeControls) => {
            if (cancelled || !result) return;
            const detectedIsbn = normalizeIsbn(result.getText());
            if (!detectedIsbn) {
              nonIsbnSeenRef.current = true;
              setMessage("ISBN以外のバーコードです。ISBNを探しています…");
              return;
            }

            activeControls.stop();
            controlsRef.current = null;
            onIsbnChange(detectedIsbn);
            setMessage("ISBNを記録しました。");
            navigator.vibrate?.([18, 12, 24]);
            setScanning(false);
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      } catch {
        if (cancelled) return;
        setMessage("カメラを開始できませんでした。ブラウザのカメラ権限を確認してください。");
        setScanning(false);
      }
    })();

    return () => {
      cancelled = true;
      stopScan();
    };
  }, [onIsbnChange, scanning, stopScan]);

  useEffect(() => stopScan, [stopScan]);

  function beginScan() {
    stopScan();
    setScanning(true);
  }

  function cancelScan() {
    stopScan();
    setScanning(false);
    setMessage(isbn ? "ISBNを記録しています。" : "バーコード読み取りを中止しました。");
  }

  return (
    <section className="isbn-panel" aria-labelledby="isbn-panel-title">
      <p className="crop-help" id="isbn-panel-title">
        <span>3</span> 裏表紙のISBNバーコードを読み取ります
      </p>
      {scanning ? (
        <div className="isbn-camera-panel">
          <div className="isbn-camera-preview">
            <video ref={videoRef} autoPlay muted playsInline aria-label="ISBNバーコード読み取り映像" />
            <div className="isbn-camera-guide" aria-hidden="true" />
          </div>
          <button className="retake" type="button" onClick={cancelScan}>読み取りを中止する</button>
        </div>
      ) : (
        <div className="isbn-actions">
          <button className="isbn-scan-button" type="button" onClick={beginScan}>
            {isbn ? "ISBNバーコードを読み直す" : "ISBNバーコードを読み取る"}
          </button>
          {isbn && (
            <button
              className="retake"
              type="button"
              onClick={() => {
                onIsbnChange(null);
                setMessage("ISBNを登録しない設定にしました。");
              }}
            >
              ISBNを登録しない
            </button>
          )}
        </div>
      )}
      {message && <p className="isbn-message" aria-live="polite">{message}</p>}
    </section>
  );
}
