import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BookLibrary } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("アプリの表示領域が見つかりません。");

createRoot(root).render(
  <StrictMode>
    <BookLibrary />
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/tsundoku-dial/sw.js")
      .catch((error: unknown) => {
        console.error("Service Workerの登録に失敗しました。", error);
      });
  });
}
