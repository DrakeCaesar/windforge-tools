/**
 * Shared numeric formatting for catalog stat cells (main table + clothing loadout).
 */

/**
 * Non-price numeric cells: round to 3 decimal places; optional fixed decimals per column.
 * @param {number|null|undefined} v
 * @param {{ hideZero?: boolean, decimals?: number }} [opts]
 *   - hideZero: if true, exact 0 renders as empty (catalog convention).
 * @returns {string}
 */
export function formatCatalogStatNumber(v, opts) {
  const hideZero = opts && opts.hideZero;
  if (v == null || typeof v !== "number" || Number.isNaN(v)) return "—";
  if (hideZero && v === 0) return "";
  const rounded = Math.round(v * 1000) / 1000;
  const fixedDecimals = opts && Number.isFinite(opts.decimals) ? opts.decimals : null;
  if (fixedDecimals != null) {
    const d = Math.max(0, Math.min(3, Math.trunc(fixedDecimals)));
    return rounded.toFixed(d);
  }
  let s = rounded.toFixed(3);
  s = s.replace(/(\.\d*?)0+$/, "$1");
  if (s.endsWith(".")) s = s.slice(0, -1);
  return s;
}

/**
 * Same decimal policy as {@link computeStatColumnDecimalsForList} in app.js: choose 0–3
 * fixed decimals from the precision present in the samples.
 * @param {number[]} values — finite numbers
 * @returns {number} 0–3, or 3 when values is empty
 */
export function computeStatDecimalsFromValues(values) {
  if (!values.length) return 3;
  let keepTenths = false;
  let keepHundredths = false;
  let keepThousandths = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== "number" || Number.isNaN(v)) continue;
    const scaled = Math.round(Math.abs(v) * 1000);
    if (scaled % 10 !== 0) keepThousandths = true;
    if (Math.floor(scaled / 10) % 10 !== 0) keepHundredths = true;
    if (Math.floor(scaled / 100) % 10 !== 0) keepTenths = true;
    if (keepThousandths) break;
  }
  return keepThousandths ? 3 : keepHundredths ? 2 : keepTenths ? 1 : 0;
}
