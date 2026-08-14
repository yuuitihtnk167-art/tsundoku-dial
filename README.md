# 積読ダイヤル

スマートフォンで本の表紙を撮影し、必要な範囲だけを切り抜いて積読本棚へ保存する静的Webアプリです。

## 現在できること

- スマートフォンの背面カメラから表紙を撮影
- 上下左右の範囲を調整して表紙だけを切り抜き
- タイトルとメモを付けて保存
- 表紙を登録日の新しい順に一覧表示
- 表紙をタップして詳細を表示
- 書籍情報と表紙画像をブラウザのIndexedDBへ保存

保存内容は端末とブラウザごとに独立します。別端末との同期、ブラウザ変更時の引き継ぎ、プライベートブラウズでの永続保存には対応していません。

## 開発

Node.js 22.13以上が必要です。

```bash
npm install
npm run dev
```

確認用コマンド:

```bash
npm run lint
npm test
```

## GitHub Pages

`.github/workflows/deploy-pages.yml` が `main` ブランチへのpushを検知し、静的ファイルをビルドして公開します。

GitHubリポジトリの `Settings` → `Pages` → `Build and deployment` で、Sourceを `GitHub Actions` に設定してください。
