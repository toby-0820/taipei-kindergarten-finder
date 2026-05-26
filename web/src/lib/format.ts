export function fmtKm(km: number | null): string {
  if (km == null) return "—";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

export function fmtPct(p: number | null): string {
  if (p == null) return "—";
  return `${Math.round(p * 100)}%`;
}

export function fmtTimeAgo(unixMs: number | null): string {
  if (!unixMs) return "尚無資料";
  const diff = Date.now() - unixMs;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "剛剛更新";
  if (min < 60) return `${min} 分鐘前`;
  return `${Math.floor(min / 60)} 小時前`;
}
