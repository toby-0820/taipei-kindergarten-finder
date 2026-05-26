# 台北幼兒園即時查

公開、免費的台北市公幼／非營利幼兒園即時招生查詢站。

- 輸入家裡地址或學校名稱，列出附近園所
- 顯示今年招生名額與即時報名數（每 3 分鐘更新）
- 依順位分別估算中籤機率

**資料來源：** 臺北市政府教育局 kid.tp.edu.tw, npkid.tp.edu.tw

## 開發

```
pnpm install
pnpm dev:worker   # 本機跑 Worker (port 8787)
pnpm dev:web      # 本機跑 Astro (port 4321)
pnpm test
```

詳細設計請見 `docs/superpowers/specs/`。
