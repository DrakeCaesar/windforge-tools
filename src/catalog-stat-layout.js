import {
  formatCatalogStatNumber,
  computeStatDecimalsFromValues,
  measureCatalogStatTextWidthForSignedDelta,
} from "./catalog-stat-format.js";

const COL_PX_MIN = 40;
const COL_PX_MAX = 96;
const COL_PX_STAT_DEFAULT = 72;
/** Horizontal slack so `measureText` width fits inside `td` padding + borders (wiki-table cells use 4px sides). */
const COL_MEASURE_PAD_PX = 10;

/**
 * Per-column decimals and pixel widths for clothing stat columns (mirrors main table stat sizing).
 * @param {object[]} clothingItems
 * @param {object[]} columnDefs — column defs with `.id` and clothing keys
 * @param {(item: object, col: object) => number|null} getStatValue
 * @param {{
 *   measureFontFromEl?: Element|null,
 *   footerSumByColId?: Record<string, number>|null,
 *   theoreticalMaxSumByColId?: Record<string, number>|null,
 * }} [opts]
 * @returns {{ decimalsById: Record<string, number>, widthById: Record<string, number> }}
 */
export function measureClothingLoadoutColumnMetrics(
  clothingItems,
  columnDefs,
  getStatValue,
  opts
) {
  const measureEl = (opts && opts.measureFontFromEl) || document.body;
  const footerSumByColId = (opts && opts.footerSumByColId) || null;
  const theoreticalMaxSumByColId = (opts && opts.theoreticalMaxSumByColId) || null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const decimalsById = Object.create(null);
    const widthById = Object.create(null);
    for (let c = 0; c < columnDefs.length; c++) {
      decimalsById[columnDefs[c].id] = 3;
      widthById[columnDefs[c].id] = COL_PX_STAT_DEFAULT;
    }
    return { decimalsById, widthById };
  }
  ctx.font = getComputedStyle(measureEl).font || "14px system-ui";

  /** @type {Record<string, number>} */
  const decimalsById = Object.create(null);
  /** @type {Record<string, number>} */
  const widthById = Object.create(null);

  for (let c = 0; c < columnDefs.length; c++) {
    const col = columnDefs[c];
    const colId = col.id;
    const values = [];
    for (let i = 0; i < clothingItems.length; i++) {
      const v = getStatValue(clothingItems[i], col);
      if (v != null && typeof v === "number" && !Number.isNaN(v)) values.push(v);
    }
    decimalsById[colId] = computeStatDecimalsFromValues(values);
    const dec = decimalsById[colId];
    let maxTextPx = 0;
    for (let i = 0; i < clothingItems.length; i++) {
      const v = getStatValue(clothingItems[i], col);
      if (v == null || typeof v !== "number" || Number.isNaN(v)) continue;
      const txt = formatCatalogStatNumber(v, { hideZero: true, decimals: dec });
      if (!txt) continue;
      const w = measureCatalogStatTextWidthForSignedDelta(ctx, txt);
      if (w > maxTextPx) maxTextPx = w;
    }
    if (footerSumByColId && Object.prototype.hasOwnProperty.call(footerSumByColId, colId)) {
      const sn = footerSumByColId[colId];
      if (typeof sn === "number" && !Number.isNaN(sn)) {
        const sumTxt = formatCatalogStatNumber(sn, { hideZero: false, decimals: dec });
        if (sumTxt && sumTxt !== "—") {
          const w = measureCatalogStatTextWidthForSignedDelta(ctx, sumTxt);
          if (w > maxTextPx) maxTextPx = w;
        }
      }
    }
    if (
      theoreticalMaxSumByColId &&
      Object.prototype.hasOwnProperty.call(theoreticalMaxSumByColId, colId)
    ) {
      const tn = theoreticalMaxSumByColId[colId];
      if (typeof tn === "number" && !Number.isNaN(tn)) {
        const tTxt = formatCatalogStatNumber(tn, { hideZero: false, decimals: dec });
        if (tTxt && tTxt !== "—") {
          const w = measureCatalogStatTextWidthForSignedDelta(ctx, tTxt);
          if (w > maxTextPx) maxTextPx = w;
        }
      }
    }
    widthById[colId] = Math.max(
      COL_PX_MIN,
      Math.min(COL_PX_MAX, Math.ceil(maxTextPx) + COL_MEASURE_PAD_PX)
    );
  }

  return { decimalsById, widthById };
}
