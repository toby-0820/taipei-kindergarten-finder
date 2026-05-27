# 台北幼兒園即時查

> 公開、免費、無帳號的台北市公幼 / 非營利幼兒園即時招生查詢站。
> 線上展示：**<https://taipei-himmel.pages.dev>**

輸入家裡地址或學校名稱，立刻看到：

- 附近所有 公幼／非營利 園所，依距離或中籤機率排序
- 每園所每班別（3-5 歲混齡／5/4/3 歲／2 歲專班）即時報名數
- 按你的 **順位** 推估的中籤機率（含「含我」、「雙胞胎綁籤」兩種試算）
- 你輸入的地址在哪個 國小學區（自動標記學區內公幼附幼）

## 為什麼做這個

每年 4-6 月台北市公幼／非營利幼兒園招生期，家長要：

1. 翻台北市教育局兩個招生系統（[kid.tp.edu.tw](https://kid.tp.edu.tw)、[npkid.tp.edu.tw](https://npkid.tp.edu.tw)）
2. 自己換算「招生名額 ÷ 同順位報名數」推估機率
3. 再去 [學區順位系統](https://schooldistrict.tp.edu.tw) 查自己住址的學區
4. 三個地方來回比對，看 12 個行政區、200+ 園所

這站把這些整合：地址一輸入，附近園所 + 各班別機率 + 學區判定 一次看完。

## 技術

| 元件 | 用途 | 部署位置 |
|---|---|---|
| Astro 4（靜態） | 前端、地圖、UI | Cloudflare Pages |
| Cloudflare Workers | API、爬蟲、cron | Workers Free tier |
| D1（邊緣 SQLite） | 學校 / snapshot / 學區 | 同上 |
| KV | TPGOS / 地址 geocoding cache | 同上 |
| Leaflet + OSM | 地圖 | CDN |
| Nominatim | 學校地址 → 經緯度 | 公開 API |
| TPGOS + checkSchoolByVillage | 地址 → 學區國小 | 台北市教育局公開服務 |

爬蟲每 3 分鐘觸發一次 cron，分 3 批輪流（Workers Free 50 subrequest 限制），全市資料 **每 9 分鐘** 完整刷新一次。

## 資料來源

所有招生資料都是**直接 fetch + parse 台北市政府教育局公開頁面**：

- **公幼**（公立幼兒園）：[kid.tp.edu.tw](https://kid.tp.edu.tw)
  - 3-5 歲混齡班 + 2 歲專班
- **非營利幼兒園**：[npkid.tp.edu.tw](https://npkid.tp.edu.tw)
  - 5 歲 / 4 歲 / 3 歲 / 2 歲專班
- **學校地址**：[教育部全國幼兒園基本資料](https://stats.moe.gov.tw/files/opendata/k1_new.csv)
- **學區判定**：[臺北市學區順位系統](https://schooldistrict.tp.edu.tw) + TPGOS GIS

本站僅做即時整合呈現，所有原始資料權歸臺北市政府教育局所有。資料正確性以官方公告為準。

## 自己跑

### 0. 環境需求

- Node 20+ / pnpm 9+
- Cloudflare 帳號（免費）+ `wrangler` CLI

### 1. clone & install

```bash
git clone https://github.com/<你的帳號>/taipei-kindergarten-finder
cd taipei-kindergarten-finder
pnpm install
```

### 2. 建立你自己的 Cloudflare 資源

```bash
wrangler login
wrangler d1 create kindergarten_db          # 記下 database_id
wrangler kv namespace create geocode_cache  # 記下 id
wrangler kv namespace create geocode_cache --preview  # 記下 preview_id
```

把回傳的三個 ID **複製貼到 `wrangler.toml` 對應位置**。

### 3. 套用 D1 schema

```bash
wrangler d1 migrations apply kindergarten_db --local   # 本機
wrangler d1 migrations apply kindergarten_db --remote  # 正式
```

### 4. 灌入學校地址 + 一次性 geocode

```bash
node scripts/import-moe-addresses.mjs                  # 從教育部 CSV 灌入 215 間學校地址
REMOTE=1 node scripts/full-rescrape.mjs                # 抓所有班別 snapshot
REMOTE=1 node scripts/regeocode-with-validation.mjs    # 用 Nominatim 補座標
```

### 5. 設定 secret 並部署

```bash
echo "$(openssl rand -hex 32)" | wrangler secret put ADMIN_TOKEN
echo "" | wrangler secret put DISCORD_WEBHOOK_URL      # 不用 Discord 警示就留空
wrangler deploy                                         # 部署 Worker (含 cron)

# 前端
wrangler pages project create <你的-pages-name> --production-branch main
PUBLIC_API_BASE=https://kindergarten-api.<你的 subdomain>.workers.dev \
  pnpm --filter web build
wrangler pages deploy web/dist --project-name <你的-pages-name> --branch main
```

### 6. 本機開發

```bash
pnpm --filter worker dev                                                       # API on :8787
PUBLIC_API_BASE=http://localhost:8787 pnpm --filter web dev                    # Astro on :4321
```

打 http://localhost:4321 看頁面。

### 7. 跑測試

```bash
pnpm --filter worker test    # vitest: distance, probability, parser, mode-detect
```

## 專案結構

```
taipei-kindergarten-finder/
├── web/                     # Astro 前端
│   ├── src/components/      # SearchBar, MapView, ResultCard...
│   ├── src/pages/index.astro  # 主頁邏輯（vanilla TS, 約 700 行）
│   └── src/lib/             # api-client, probability, format
├── worker/                  # Cloudflare Worker
│   ├── src/routes/          # /api/search, /api/school/:id, /api/school-district
│   ├── src/scraper/         # fetch-pages, parse, cron, upsert
│   ├── src/lib/             # db, geocode, distance, probability
│   └── test/                # vitest 單元測試 + 真實 HTML fixtures
├── migrations/0001_initial.sql  # D1 schema
├── scripts/                 # 一次性匯入腳本
└── docs/superpowers/        # 設計 spec + 實作計畫（開發過程紀錄）
```

## 重要演算法

### 順位機率計算（`worker/src/lib/probability.ts`）

台北市公幼/非營利採**階層抽籤**：第 1 順位先抽，全錄取後剩餘名額才給第 2 順位⋯⋯以此類推。

```typescript
calcByPriority(capacity, [reg_p1, reg_p2, ..., reg_pN])
→ 回傳每順位的機率陣列
```

### 「含我試算」

如果用戶報名了，所有人的機率會怎麼變？把使用者的順位 +1 報名數，重跑階層 cascade：

```typescript
calcByPriorityWithSelf(capacity, regs, selfIdx)
```

### 雙胞胎綁籤（`calcByPriorityWithTwinBind`）

雙胞胎一起報名、綁籤 = 一抽兩個位、同進同出：

```
P_bind = max(0, remaining - 1) / max(1, reg - 1)
```

bundle 用 2 個位，但只佔 1 個籤條（reg 減去 1 因為雙胞胎 2 個 reg 算 1 個 entry）。

## 已知限制

- Cloudflare Workers Free tier 50 subrequest 限制 → 全市完整刷新週期 9 分鐘（非 3 分鐘）。升級 Workers Paid（$5/月）可恢復 3 分鐘。
- 學校地址 geocoding 用 Nominatim（OSM），部分學校的精確門牌號可能對到路口而非建築物。
- 報名期外（非 4-6 月）API 仍會回招生名額但 `window_mode='closed'`，機率欄會空白。
## 法律 / 免責

- 本站為**非官方**資訊整合工具。所有招生數據以臺北市政府教育局官方公告為準。
- 機率為 即時報名數 ÷ 招生名額 的 數學推算，**非保證** 錄取結果。
- 學區判定資訊以 [臺北市學區順位系統](https://schooldistrict.tp.edu.tw) 為準。

## License

MIT — 詳見 [LICENSE](LICENSE)。

## 致謝

- 臺北市政府教育局 公布完整即時招生資料、學區查詢服務
- 教育部 統計處 全國幼兒園基本資料 開放資料
- OpenStreetMap + Nominatim 免費 geocoding
- Leaflet 開源地圖元件
- Cloudflare Workers / Pages / D1 / KV 免費邊緣運算 + 資料庫

---

> Built with [Claude Code](https://claude.com/claude-code).
