# 台北幼兒園即時查 — 設計文件

**日期**：2026-05-26
**狀態**：草稿（待用戶確認）
**作者**：xiaolongxia + Claude

---

## 1. 目標

一個公開、免費的網站，協助台北市家長：

1. 輸入**家裡地址**或**學校名稱**，列出附近的**公幼**與**非營利幼兒園**
2. 顯示每園所**今年招生名額**與**即時報名數**（資料源每 3 分鐘自動更新）
3. 依**順位**（第 1 順位至第 5 順位）分別估算**中籤機率**
4. 用**地圖 + 清單**雙欄呈現，按距離排序

### 不做（YAGNI）

- 不做新北、桃園或其他縣市（後續才考慮）
- 不做歷年抽籤資料比對（資料源未公開、且使用者只要看今年）
- 不做帳號 / 個人化（公開即用）
- 不做私立、準公共幼兒園
- 不做行動原生 App（PWA 加 manifest 即可）

---

## 2. 範圍與需求總結

| 維度 | 規格 |
|---|---|
| **服務區域** | 台北市 |
| **學園類型** | 公立幼兒園、非營利幼兒園 |
| **年齡別** | 2 歲（2 歲專班）+ 3-5 歲（3-5 歲混齡班）— 即「2-5 歲全覆蓋」 |
| **使用者** | 公開免費、無帳號 |
| **輸入方式** | 地址（查附近）或 學校名稱（查單校） |
| **距離計算** | 直線距離（Haversine） |
| **資料更新** | 3 分鐘一次（與資料源刷新節奏對齊） |
| **中籤機率** | 依順位階層計算，僅在「報名期」內顯示 |
| **非報名期 UX** | 機率欄顯示「報名未開始」；名額欄正常顯示 |
| **主視覺** | 地圖 + 清單雙欄 |

---

## 3. 資料源

從 spike 階段（2026-05-26 實測）確認：

| 站點 | URL | 性質 |
|---|---|---|
| 公幼 | https://kid.tp.edu.tw/ | Server-rendered ASP.NET（`Board.aspx?dist=X`） |
| 非營利 | https://npkid.tp.edu.tw/ | Server-rendered ASP.NET（同上格式） |

**重要發現**：
- 兩站結構幾乎相同 → 一套 parser 可同時對應
- 頁面自帶「本頁資訊每 3 分鐘定時更新」字樣 → 源頭即時刷新
- **班別只有兩種**：`3-5 歲班`、`2 歲專班`（混齡，非「幼幼/小/中/大」）
- 12 區分頁瀏覽（松山、信義、大安、中山、中正、大同、萬華、文山、南港、內湖、士林、北投）
- 區代碼（`dist=X` 的 X）需在實作時實測比對

### Geocoding 來源
- 主要：**TGOS / NLSC**（內政部）API，免費註冊
- 備援：**OpenStreetMap Nominatim**

---

## 4. 整體架構

```
┌──────────────────────────────────────────────────────────┐
│  使用者瀏覽器                                              │
│  Astro 靜態頁 (Cloudflare Pages)                          │
│  ├─ 地址/校名 輸入 → /api/search                          │
│  ├─ Leaflet 地圖 + OSM 圖磚                                │
│  └─ 結果清單（距離 / 名額 / 報名數 / 順位機率）             │
└──────────────────────────────────────────────────────────┘
              │ HTTPS
              ▼
┌──────────────────────────────────────────────────────────┐
│  Cloudflare Workers（邊緣 API）                            │
│  ├─ /api/search?address=... | school=...                  │
│  ├─ /api/school/:id                                       │
│  └─ /api/geocode?addr=...                                 │
└──────────────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────┐
│  Cloudflare D1（邊緣 SQLite）                             │
│  資料表：schools, snapshots, registration_window           │
└──────────────────────────────────────────────────────────┘
              ▲ 寫入
              │
┌──────────────────────────────────────────────────────────┐
│  Cloudflare Workers Cron Trigger（*/3 * * * *）            │
│  1. fetch kid.tp.edu.tw + npkid.tp.edu.tw                 │
│  2. 解析 → 比對前一次 → upsert snapshots                   │
│  3. 偵測報名期 mode (open / closed / drawn)                │
└──────────────────────────────────────────────────────────┘
```

### 關鍵架構選擇
- **路徑 A：Cloudflare 全家桶**（Pages + Workers + D1 + KV）
- **理由**：唯一能穩定做到 3 分鐘 cron 且完全免費；邊緣資料庫 + CDN
- **前端**：Astro 靜態 build → Pages
- **資料快取**：API 不快取（要實時），geocoding 用 KV 快取 24h

---

## 5. 資料層

### D1 Schema

```sql
-- 學校主檔
CREATE TABLE schools (
  id              TEXT PRIMARY KEY,         -- 教育部代碼（如 "TP-100201"）
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,            -- 'public' | 'non_profit'
  district        TEXT NOT NULL,            -- "中山區"
  address         TEXT NOT NULL,
  lat             REAL NOT NULL,
  lng             REAL NOT NULL,
  phone           TEXT,
  website         TEXT,
  classes_json    TEXT NOT NULL,            -- [{age_band, capacity}, ...]
  updated_at      INTEGER NOT NULL
);

-- 即時報名快照（只留最新 + 上一次）
CREATE TABLE snapshots (
  school_id       TEXT NOT NULL,
  age_band        TEXT NOT NULL,            -- '3-5歲班' | '2歲專班'
  capacity        INT  NOT NULL,
  reg_p1          INT,                       -- 第 1 順位報名數
  reg_p2          INT,
  reg_p3          INT,
  reg_p4          INT,
  reg_p5          INT,
  reg_total       INT,                       -- 驗證用
  fetched_at      INTEGER NOT NULL,
  is_latest       INTEGER NOT NULL,          -- 1 = 最新, 0 = 上一次
  PRIMARY KEY (school_id, age_band, is_latest)
);

-- 全市報名期狀態（單列）
CREATE TABLE registration_window (
  id                INTEGER PRIMARY KEY CHECK (id=1),
  mode              TEXT NOT NULL,           -- 'closed' | 'open' | 'drawn'
  detected_at       INTEGER NOT NULL,
  priority_labels   TEXT,                    -- JSON 陣列：["第 1 順位：低收入...", ...]
  notes             TEXT
);
```

### 爬蟲流程（Workers Cron `*/3 * * * *`）

```
1. fetch https://kid.tp.edu.tw/Board.aspx?dist={each district}
2. fetch https://npkid.tp.edu.tw/Board.aspx?dist={each district}
3. 解析 HTML → 提取 (school_id, name, address, classes[], reg_pN[])
4. 對每筆：
   ├─ schools 表中不存在 → INSERT（同時呼叫 TGOS geocoding）
   ├─ schools 地址變了 → UPDATE + re-geocode
   └─ snapshots 表：舊的 is_latest=1 → 0；新的寫入 is_latest=1
5. 偵測 mode：
   ├─ 任一 reg_pN 為非 NULL 且 > 0 → 'open'
   ├─ 全市 reg_pN 都為 NULL → 'closed'
   └─ 過公告抽籤日 → 'drawn'
6. 任一站失敗 → 該站沿用前次資料；連續 5 次失敗 → Discord 警示
```

### 時鐘對齊
- Cron 跑於分鐘 `:00:30, :03:30, :06:30...`，與資料源整 3 分鐘錯開 90 秒
- 確保抓到的是剛刷新的、不是即將被覆蓋的

### 重複請求節省
- 若連兩次 fetch 拿到的 HTML hash 完全相同 → 不寫 DB，僅更新 `last_check_at`

---

## 6. API

### `GET /api/search`

Query：
- `address` (string, optional)：使用者家裡地址
- `school` (string, optional)：學校名稱模糊搜尋
- `age_band` (string, optional)：`3-5歲班` | `2歲專班` | 不填=全部
- `priority` (1-5, optional)：「我的順位」
- `limit` (int, default 20)

邏輯：
1. 若有 `address` → 內部呼叫 TGOS geocoding 取得 lat/lng
2. 撈 `schools` JOIN 最新 `snapshots`
3. 計算 Haversine 距離（如有座標）
4. 依距離升冪排序，取前 `limit`
5. 計算每順位機率（見第 7 段）
6. 回傳 `{window_mode, query_lat, query_lng, results: [...]}`

回應（範例）：
```jsonc
{
  "window_mode": "open",
  "query_lat": 25.05, "query_lng": 121.55,
  "fetched_at": 1716700000,
  "results": [
    {
      "school_id": "TP-100201",
      "name": "臺北市立中山幼兒園",
      "type": "public",
      "district": "中山區",
      "address": "臺北市中山區...",
      "lat": 25.06, "lng": 121.54,
      "distance_km": 0.8,
      "phone": "...", "website": "...",
      "classes": [
        {
          "age_band": "3-5歲班",
          "capacity": 60,
          "registrations": {
            "p1": 5, "p2": 8, "p3": 22, "p4": 30, "p5": 80,
            "total": 145
          },
          "probabilities": {
            "p1": 1.00, "p2": 1.00, "p3": 1.00,
            "p4": 0.83, "p5": 0.00
          }
        }
      ]
    }
  ]
}
```

### `GET /api/school/:id`
- 回傳單一學校詳情 + 最新 snapshot + 前一次 snapshot（顯示變化趨勢）

### `GET /api/geocode?addr=...`
- KV 快取 24h（key = SHA-256(addr)，避免明文）
- cache miss 才呼叫 TGOS

---

## 7. 中籤機率算法（順位感知）

### 階層抽籤規則
1. 第 1 順位（低收入、身障、原住民、特殊境遇等）優先全錄取
2. 第 1 順位錄完，剩餘名額才給第 2 順位
3. 以此類推，同順位內名額不足才抽籤

### 演算法
```javascript
function calcByPriority(capacity, regs /* [p1,p2,p3,p4,p5] */) {
  let remaining = capacity;
  const probs = [];
  for (const reg of regs) {
    if (reg == null || reg === 0) {
      probs.push(null);            // 此順位無人報名
      continue;
    }
    if (remaining >= reg) {
      probs.push(1.0);
      remaining -= reg;
    } else if (remaining > 0) {
      probs.push(remaining / reg);
      remaining = 0;
    } else {
      probs.push(0.0);
    }
  }
  return { probs, remaining_after_all: remaining };
}
```

### 重要 UX 注意
- 機率為「依目前報名數推算」，**非保證**最終錄取
- 報名期外（`window_mode != 'open'`）一律顯示 `null`，前端顯示「報名未開始」
- 順位定義由爬蟲從招生公告抓出 → 存 `registration_window.priority_labels`

---

## 8. 前端 UI

### 頁面結構

```
┌─────────────────────────────────────────────────────────────────┐
│  Header：站名 + 資料更新時間 + window_mode banner                  │
├─────────────────────────────────────────────────────────────────┤
│  搜尋列：[地址 / 校名] radio + 輸入框 + 查詢                       │
│  篩選列：☑公幼 ☑非營利  班別[全部▾]  我的順位[未指定▾]            │
├──────────────────────────────┬──────────────────────────────────┤
│  清單（左欄）                  │  地圖（右欄，Leaflet+OSM）        │
│  學校卡片可展開順位明細         │  hover/click 同步高亮             │
└──────────────────────────────┴──────────────────────────────────┘
```

### 互動 Flow

**A. 地址查附近**
1. 用戶輸入地址（debounce 500ms）
2. 呼叫 `/api/search?address=...`
3. 渲染清單 + 地圖 fitBounds 到「家 + 前 10 名」

**B. 學校名稱查**
1. 首屏載入時預載學校名稱清單 (~10KB inline)
2. 輸入時 client-side 模糊匹配 + autocomplete
3. 選定 → 跳單校詳情

**C. 點清單卡片**
- 展開順位明細表（5 列：報名數、機率、上次差值）
- 顯示「報名期最後一日」倒數

### 「我的順位」UX
- 預設未指定 → 顯示「最寬鬆順位」（p5 一般幼兒）機率
- 選定 1-5 → 整個清單機率欄即時用該順位重算（純前端，不需重打 API）
- 旁邊 ⓘ tooltip 顯示當年招生簡章順位定義

### 報名期外（mode != open）
- 頂部黃 banner 提示
- 機率欄整片顯示「—」
- 名額欄正常顯示

### 行動裝置
- `< 768px`：地圖 collapse 到頂部摺疊抽屜
- PWA manifest 加「加到主畫面」

### 性能目標
- 首屏 < 1.5s（LCP）
- API < 100ms（Worker + D1 邊緣）
- Lighthouse mobile 90+

### 法律免責（固定 footer）
- 資料來源：臺北市政府教育局 kid.tp.edu.tw、npkid.tp.edu.tw
- 機率為依目前報名/名額即時推算，最終以官方抽籤結果為準
- 本站非官方平台

---

## 9. 錯誤處理與邊界

### 爬蟲層
| 情境 | 處理 |
|---|---|
| 單站 5xx / timeout | retry 2 次 (5s/15s)；仍失敗保留前次資料 |
| 兩站連敗 5 次 | Discord 警示；前端 banner「資料同步延遲中」 |
| 頁面結構改變 | 必要欄位缺失整筆跳過 + log |
| 學校暫時下架 | 不刪 schools 主檔，snapshots 不更新 |
| Geocoding 失敗 | lat/lng 標 NULL，下次 cron 重試 |
| Cron 沒跑 | 前端依 `fetched_at` 計算「N 分鐘前」，>15 分鐘顯示警示 |

### API 層
| 情境 | HTTP |
|---|---|
| address + school 都空 | 400 |
| Geocode 找不到 | 200, `geocode_status:"not_found"` + hint |
| 地址不在台北 | 200, `geocode_status:"out_of_scope"` + 偵測到的縣市 |
| 學校無匹配 | 200, results=[], 給 3 個 Levenshtein 建議 |
| D1 異常 | 503 + retry_after |
| Worker 超時 | 504 |

### 前端
| 情境 | 處理 |
|---|---|
| 無網路 | service worker fallback 靜態頁 |
| 機率 0% | 中性色「依目前報名數已額滿，可填候補」 |
| 機率 100% | 「依目前數據全錄取」+ ⓘ 仍依抽籤 |
| 同順位人數=名額 | 100% + 註「臨界，建議備案」 |
| capacity=0 | 該班別不顯示 |
| 0 筆結果 | 「附近 5km 無，要看更遠？」 |

### 隱私 / 安全
- 不存使用者資料（地址查完即丟）
- Geocode 快取 key 用 SHA-256
- 無 cookie、無 IP 追蹤的 analytics
- CSP 鎖外部資源

### 資料正確性
- 每天 03:00 校驗 cron：抽 3 個樣本比對線上 → 不一致 Discord 警示
- Admin route（Cloudflare Access 限制）可緊急隱藏錯資料的園所

---

## 10. 3 分鐘更新的全鏈路保證

| 環節 | 機制 |
|---|---|
| 資料源 | 兩站自帶 3 分鐘刷新 |
| 爬蟲 cron | `*/3 * * * *`，邊緣精度 ±5s |
| DB 寫入 | < 8 秒 / 站 |
| 前端讀取 | API 不快取 |
| 時間戳 | API 回傳 `fetched_at`，前端顯示「N 分鐘前」 |
| 失敗保護 | 1 次失敗沿用舊資料；3 次連敗警示 |
| 時鐘對齊 | cron 錯開源頭 90 秒，抓剛刷新的 |
| 用戶端輪詢 | 停留 > 3 分鐘自動 refresh |

---

## 11. 測試策略

### 單元測試（Vitest）
- `calcByPriority()`：8-10 個 edge case
- `haversineKm()`：5 個座標對比對
- `parseKidPage(html)` / `parseNpkidPage(html)`：用 fixture HTML

### 整合測試（Miniflare）
- `/api/search` 完整流程
- mode 切換（open / closed / drawn）
- 爬蟲失敗 fallback

### E2E（Playwright，少量）
- 地址查 → 結果 → 地圖
- 校名查 → autocomplete → 詳情
- 行動 viewport smoke test

### 對線健康檢查（每天 03:00 cron）
- 抓真實頁面 → 必要欄位齊全？
- 失敗 → Discord 警示

---

## 12. 部署

### Repo 結構
```
taipei-kindergarten-finder/
├─ web/          Astro 靜態前端
├─ worker/       Cloudflare Worker (api + cron)
├─ migrations/   D1 schema migrations
├─ fixtures/     HTML 測試樣本
└─ docs/
```

### CI（GitHub Actions, on push to main）
1. `pnpm install`
2. `pnpm test`
3. `pnpm build`（Astro）
4. `wrangler deploy`（Worker + Cron）
5. `wrangler pages deploy`（前端）
6. `wrangler d1 migrations apply`

### Cloudflare 資源
- **Pages**：kindergarten-finder.pages.dev
- **Worker**：kindergarten-api（Cron `*/3 * * * *`）
- **D1**：kindergarten_db
- **KV**：geocode_cache

### Cron 排程
- 每 3 分鐘：兩站爬蟲 + snapshots
- 每 24 小時：清 14 天前 error log
- 每天 03:00：對線健康檢查

### 環境變數（Cloudflare Secret）
- `TGOS_API_KEY`
- `DISCORD_WEBHOOK_URL`
- `ADMIN_ACCESS_TOKEN`

### 上線分階段
| Phase | 工作 | 時程 |
|---|---|---|
| 1 | 爬蟲 + D1 跑通，無前端 | 1 週 |
| 2 | API endpoint 上線 + Postman 驗證 | 1 週 |
| 3 | Astro 前端 + 地圖 + 清單 | 1 週 |
| 4 | 順位機率 UI + 「我的順位」 | 3 天 |
| 5 | E2E + Lighthouse 90+ + 法律文案 | 3 天 |
| 6 | 公開上線 | — |

### 啟動前 checklist
- [ ] TGOS API key（內政部免費註冊）
- [ ] Cloudflare 帳號 + 開通 Pages / Workers / D1 / KV
- [ ] 確認 kid.tp.edu.tw、npkid.tp.edu.tw 在非報名期可看到「招生名額」
- [ ] 實測 12 區 dist 代碼對應表
- [ ] Discord webhook for 警示

---

## 13. 已知風險

| 風險 | 緩解 |
|---|---|
| 兩站今年改版（HTML 結構變） | parser 必要欄位驗證 + 每日健康檢查 + Discord 警示 |
| 報名期實際欄位名稱與假設不符 | spike 階段（非報名期）只能看到結構，4 月開放後第一週每天人工驗證 |
| 順位定義今年改了（5 個變 6 個） | snapshots 表預留 reg_p1~p5 + reg_total，若變多用 JSON column 加 |
| TGOS 服務中斷 | fallback Nominatim；24h KV 快取緩衝 |
| 上游延遲 / 短暫錯誤 | retry + 沿用舊資料 + 前端時間戳警示 |

---

## 14. 之後可考慮（明確不在 MVP）

- 候補順位即時查詢（抽籤後階段）
- 跨年比對（要先累積 1-2 年資料）
- 推播提醒（要帳號）
- 新北市 / 桃園市
- 通勤距離（替代直線）
- 私立 / 準公共
