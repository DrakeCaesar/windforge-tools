/**
 * Clothing loadout planner: five body slots (head, torso, hands, legs, feet), stat totals,
 * five saved loadouts (localStorage), and per-slot optimization for one chosen stat.
 */

import { appendDiagonalHeaderLabel } from "./diagonal-table-header.js";
import { formatCatalogStatNumber } from "./catalog-stat-format.js";
import { measureClothingLoadoutColumnMetrics } from "./catalog-stat-layout.js";
import {
  getClothingStatValueForColumnDef,
  itemCatalogSortPermutation as SP,
} from "./sort-permutation-core.js";

/** @typedef {{ id: string, label: string, folders: string[] }} ClothingSlotDef */

/** @type {ClothingSlotDef[]} */
export const CLOTHING_SLOTS = [
  { id: "head", label: "Head", folders: ["Helmets", "Heads"] },
  { id: "torso", label: "Torso", folders: ["Shirts"] },
  { id: "hands", label: "Hands", folders: ["Hands"] },
  { id: "legs", label: "Legs", folders: ["Pants"] },
  { id: "feet", label: "Feet", folders: ["Feet"] },
];

const SLOT_FOLDER_TO_ID = (function () {
  /** @type {Record<string, string>} */
  const m = {};
  for (let s = 0; s < CLOTHING_SLOTS.length; s++) {
    const def = CLOTHING_SLOTS[s];
    for (let f = 0; f < def.folders.length; f++) {
      m[def.folders[f].toLowerCase()] = def.id;
    }
  }
  return m;
})();

function isClothingStatColumnDef(def) {
  return !!(def && (def.clothingTraitKey || def.clothingEquipField));
}

/** Same order and defs as the main table clothing columns. */
export const CLOTHING_STAT_DEFS = SP.COLUMNS.filter(isClothingStatColumnDef);

/**
 * @param {*} item
 * @returns {string|null}
 */
export function getClothingSlotId(item) {
  if (!item || item.objectType !== "ClothingItem") return null;
  const cf = item.configFile;
  if (typeof cf !== "string" || !cf) return null;
  const norm = cf.replace(/\\/g, "/");
  const m = norm.match(/\/Equipment\/([^/]+)\//i);
  if (!m) return null;
  const folder = m[1];
  const id = SLOT_FOLDER_TO_ID[folder.toLowerCase()];
  return id || null;
}

/**
 * @param {*} colDef
 * @param {number} a
 * @param {number} b
 */
function betterForOptimize(colDef, a, b) {
  if (colDef.id === "clothAirDrain") return a < b;
  return a > b;
}

/**
 * @param {object[]} clothingItems
 * @param {string} statColumnId — {@link CLOTHING_STAT_DEFS}[].id
 * @returns {Record<string, string|null>}
 */
export function computeOptimalLoadoutByStat(clothingItems, statColumnId) {
  /** @type {Record<string, string|null>} */
  const out = {};
  for (let s = 0; s < CLOTHING_SLOTS.length; s++) {
    out[CLOTHING_SLOTS[s].id] = null;
  }
  const colDef = CLOTHING_STAT_DEFS.find(function (d) {
    return d.id === statColumnId;
  });
  if (!colDef) return out;

  for (let s = 0; s < CLOTHING_SLOTS.length; s++) {
    const slotId = CLOTHING_SLOTS[s].id;
    let bestName = null;
    let bestVal = null;
    for (let i = 0; i < clothingItems.length; i++) {
      const it = clothingItems[i];
      if (!it || getClothingSlotId(it) !== slotId) continue;
      const v = getClothingStatValueForColumnDef(it, colDef);
      if (v == null) continue;
      if (
        bestVal == null ||
        betterForOptimize(colDef, v, bestVal) ||
        (v === bestVal && it.name && bestName && it.name < bestName)
      ) {
        bestVal = v;
        bestName = it.name;
      }
    }
    out[slotId] = bestName;
  }
  return out;
}

/**
 * @param {Record<string, string|null|undefined>} slotToItemName
 * @param {(name: string) => *} getItemByName
 * @returns {Record<string, number>}
 */
export function sumClothingLoadoutStats(slotToItemName, getItemByName) {
  /** @type {Record<string, number>} */
  const sums = Object.create(null);
  for (let c = 0; c < CLOTHING_STAT_DEFS.length; c++) {
    sums[CLOTHING_STAT_DEFS[c].id] = 0;
  }
  for (let s = 0; s < CLOTHING_SLOTS.length; s++) {
    const slotId = CLOTHING_SLOTS[s].id;
    const name = slotToItemName[slotId];
    if (!name) continue;
    const item = getItemByName(name);
    if (!item) continue;
    for (let c = 0; c < CLOTHING_STAT_DEFS.length; c++) {
      const col = CLOTHING_STAT_DEFS[c];
      const v = getClothingStatValueForColumnDef(item, col);
      if (typeof v === "number" && !Number.isNaN(v)) sums[col.id] += v;
    }
  }
  return sums;
}

function measureSlotColumnWidthPx(measureEl) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 56;
  ctx.font = getComputedStyle(measureEl).font || "14px system-ui";
  let maxPx = ctx.measureText("Slot").width;
  maxPx = Math.max(maxPx, ctx.measureText("Sum").width);
  for (let s = 0; s < CLOTHING_SLOTS.length; s++) {
    maxPx = Math.max(maxPx, ctx.measureText(CLOTHING_SLOTS[s].label).width);
  }
  return Math.max(48, Math.min(120, Math.ceil(maxPx + 20)));
}

function cellTextForClothingStat(item, colDef, decimals) {
  const v = item ? getClothingStatValueForColumnDef(item, colDef) : null;
  return formatCatalogStatNumber(v, { hideZero: true, decimals: decimals });
}

/**
 * @param {{
 *   root: HTMLElement,
 *   clothingObjectType: string,
 *   getItemByName: (name: string) => * | undefined,
 *   getAllItems: () => object[],
 *   displayName: (item: *) => string,
 *   renderSlotIcon: (wrap: HTMLElement, item: * | null | undefined) => void,
 *   storageKey: string,
 * }} opts
 */
export function mountClothingLoadout(opts) {
  const root = opts.root;
  const getItemByName = opts.getItemByName;
  const getAllItems = opts.getAllItems;
  const displayName = opts.displayName;
  const renderSlotIcon = opts.renderSlotIcon;
  const storageKey = opts.storageKey;

  const SLOT_IDS = CLOTHING_SLOTS.map(function (s) {
    return s.id;
  });

  function emptyLoadout() {
    /** @type {Record<string, string|null>} */
    const o = {};
    for (let i = 0; i < SLOT_IDS.length; i++) {
      o[SLOT_IDS[i]] = null;
    }
    return o;
  }

  /** @type {Record<string, string|null>[]} */
  let loadouts = [emptyLoadout(), emptyLoadout(), emptyLoadout(), emptyLoadout(), emptyLoadout()];
  let activeTab = 0;

  function clothingItems() {
    const all = getAllItems();
    const out = [];
    for (let i = 0; i < all.length; i++) {
      const it = all[i];
      if (it && it.objectType === opts.clothingObjectType) out.push(it);
    }
    return out;
  }

  /**
   * Upper bound for the Sum row: sum over slots of each slot's maximum stat (widest totals vs single-cell text).
   * @returns {Record<string, number>}
   */
  function theoreticalMaxSumByColIdForLoadout() {
    const items = clothingItems();
    /** @type {Record<string, number>} */
    const out = Object.create(null);
    for (let c = 0; c < CLOTHING_STAT_DEFS.length; c++) {
      const col = CLOTHING_STAT_DEFS[c];
      let sum = 0;
      for (let s = 0; s < CLOTHING_SLOTS.length; s++) {
        const slotId = CLOTHING_SLOTS[s].id;
        let best = null;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (!it || getClothingSlotId(it) !== slotId) continue;
          const v = getClothingStatValueForColumnDef(it, col);
          if (typeof v !== "number" || Number.isNaN(v)) continue;
          if (best == null || v > best) best = v;
        }
        if (best != null) sum += best;
      }
      out[col.id] = sum;
    }
    return out;
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (!p || typeof p !== "object") return;
      if (typeof p.active === "number" && p.active >= 0 && p.active < 5) activeTab = p.active;
      if (Array.isArray(p.loadouts) && p.loadouts.length >= 5) {
        for (let L = 0; L < 5; L++) {
          const row = p.loadouts[L];
          if (!row || typeof row !== "object") continue;
          const base = emptyLoadout();
          for (let s = 0; s < SLOT_IDS.length; s++) {
            const id = SLOT_IDS[s];
            const v = row[id];
            base[id] = typeof v === "string" && v ? v : null;
          }
          loadouts[L] = base;
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          v: 1,
          active: activeTab,
          loadouts: loadouts,
        })
      );
    } catch (e) {
      /* ignore */
    }
  }

  root.innerHTML = "";
  root.classList.add("clothing-loadout");

  const bodyLayout = document.createElement("div");
  bodyLayout.className = "clothing-loadout__body";

  const slotsCol = document.createElement("div");
  slotsCol.className = "clothing-loadout__slots-col";

  const slotsDropZone = document.createElement("div");
  slotsDropZone.className = "clothing-loadout__slots-dropzone";
  slotsDropZone.setAttribute("role", "region");
  slotsDropZone.setAttribute(
    "aria-label",
    "Equipped pieces — drop clothing from the main table; each item fills its slot automatically"
  );

  const slotsStack = document.createElement("div");
  slotsStack.className = "clothing-loadout__slots";

  /** @type {Record<string, HTMLElement>} */
  const slotEls = {};
  /** @type {Record<string, HTMLElement>} */
  const slotIconWraps = {};
  /** @type {Record<string, HTMLElement>} */
  const slotNameEls = {};
  /** @type {Record<string, HTMLButtonElement>} */
  const slotClearBtns = {};

  for (let s = 0; s < CLOTHING_SLOTS.length; s++) {
    const def = CLOTHING_SLOTS[s];
    const box = document.createElement("div");
    box.className = "clothing-loadout__slot";
    box.dataset.slotId = def.id;
    box.title = def.label;

    const lab = document.createElement("div");
    lab.className = "clothing-loadout__slot-label";
    lab.textContent = def.label;

    const iconWrap = document.createElement("div");
    iconWrap.className = "clothing-loadout__slot-icon-wrap";

    const nameEl = document.createElement("div");
    nameEl.className = "clothing-loadout__slot-name";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "clothing-loadout__slot-clear";
    clearBtn.textContent = "Clear";
    clearBtn.setAttribute("aria-label", "Clear " + def.label);

    box.appendChild(lab);
    box.appendChild(iconWrap);
    box.appendChild(nameEl);
    box.appendChild(clearBtn);

    slotsStack.appendChild(box);
    slotEls[def.id] = box;
    slotIconWraps[def.id] = iconWrap;
    slotNameEls[def.id] = nameEl;
    slotClearBtns[def.id] = clearBtn;
  }

  slotsDropZone.appendChild(slotsStack);
  slotsCol.appendChild(slotsDropZone);

  const mainCol = document.createElement("div");
  mainCol.className = "clothing-loadout__main-col";

  const toolbar = document.createElement("div");
  toolbar.className = "clothing-loadout__toolbar";

  const tabs = document.createElement("div");
  tabs.className = "clothing-loadout__tabs";
  toolbar.appendChild(tabs);

  const optRow = document.createElement("div");
  optRow.className = "clothing-loadout__optimize";

  const optLabel = document.createElement("label");
  optLabel.className = "clothing-loadout__optimize-label";
  const optSpan = document.createElement("span");
  optSpan.textContent = "Optimize";
  const optSelect = document.createElement("select");
  optSelect.className = "clothing-loadout__optimize-select";
  optSelect.setAttribute("aria-label", "Stat to optimize");
  for (let i = 0; i < CLOTHING_STAT_DEFS.length; i++) {
    const d = CLOTHING_STAT_DEFS[i];
    const o = document.createElement("option");
    o.value = d.id;
    o.textContent = d.label + (d.id === "clothAirDrain" ? " (min)" : " (max)");
    optSelect.appendChild(o);
  }
  optLabel.appendChild(optSpan);
  optLabel.appendChild(optSelect);

  const optBtn = document.createElement("button");
  optBtn.type = "button";
  optBtn.className = "clothing-loadout__optimize-btn";
  optBtn.textContent = "Apply best per slot";
  optBtn.title =
    "Pick the best item independently in each slot for the selected stat (maximum, or minimum for air drain).";

  optRow.appendChild(optLabel);
  optRow.appendChild(optBtn);

  function createLoadoutStatColgroup() {
    const colgroup = document.createElement("colgroup");
    const colSlot = document.createElement("col");
    colSlot.className = "clothing-loadout__col-slot";
    colgroup.appendChild(colSlot);
    /** @type {Record<string, HTMLTableColElement>} */
    const colByStatId = Object.create(null);
    for (let r = 0; r < CLOTHING_STAT_DEFS.length; r++) {
      const c = document.createElement("col");
      colByStatId[CLOTHING_STAT_DEFS[r].id] = c;
      colgroup.appendChild(c);
    }
    return { colgroup, colSlot, colByStatId };
  }

  const headCols = createLoadoutStatColgroup();
  const bodyCols = createLoadoutStatColgroup();

  const statsScroll = document.createElement("div");
  statsScroll.className = "table-wrap clothing-loadout__stat-table-wrap";
  const statSplit = document.createElement("div");
  statSplit.className = "table-split";
  const statXScroll = document.createElement("div");
  statXScroll.className = "table-x-scroll";
  const statXInner = document.createElement("div");
  statXInner.className = "table-x-scroll-inner";
  const headWrap = document.createElement("div");
  headWrap.className = "table-head-wrap";

  const statTableHead = document.createElement("table");
  statTableHead.className = "clothing-loadout__stat-table wiki-table wiki-table-head";
  statTableHead.appendChild(headCols.colgroup);

  const statThead = document.createElement("thead");
  const statTheadTr = document.createElement("tr");
  const thCorner = document.createElement("th");
  thCorner.className = "clothing-loadout__th-corner";
  thCorner.setAttribute("scope", "col");
  thCorner.textContent = "Slot";
  statTheadTr.appendChild(thCorner);
  for (let r = 0; r < CLOTHING_STAT_DEFS.length; r++) {
    const colDef = CLOTHING_STAT_DEFS[r];
    const th = document.createElement("th");
    th.className = "num num-diagonal hdr-diagonal-stat clothing-loadout__th-stat-col";
    th.setAttribute("scope", "col");
    if (colDef.id === "clothAirDrain") th.title = colDef.label + " (lower is better)";
    appendDiagonalHeaderLabel(th, colDef.label);
    statTheadTr.appendChild(th);
  }
  statThead.appendChild(statTheadTr);
  statTableHead.appendChild(statThead);
  headWrap.appendChild(statTableHead);

  const bodyScroll = document.createElement("div");
  bodyScroll.className = "table-body-scroll";

  const statTableBody = document.createElement("table");
  statTableBody.className = "clothing-loadout__stat-table wiki-table wiki-table-body";
  statTableBody.setAttribute(
    "aria-label",
    "Clothing stats: one row per body slot, one column per stat; footer row Sum is loadout total per stat"
  );
  statTableBody.appendChild(bodyCols.colgroup);

  const statTbody = document.createElement("tbody");
  const statTfoot = document.createElement("tfoot");
  statTableBody.appendChild(statTbody);
  statTableBody.appendChild(statTfoot);

  bodyScroll.appendChild(statTableBody);
  statXInner.appendChild(headWrap);
  statXInner.appendChild(bodyScroll);
  statXScroll.appendChild(statXInner);
  statSplit.appendChild(statXScroll);
  statsScroll.appendChild(statSplit);

  mainCol.appendChild(toolbar);
  mainCol.appendChild(optRow);
  mainCol.appendChild(statsScroll);

  bodyLayout.appendChild(slotsCol);
  bodyLayout.appendChild(mainCol);

  root.appendChild(bodyLayout);

  function isLeavingNode(container, related) {
    return related == null || !container.contains(related);
  }

  /** One drop target for the whole planner: slot is chosen from the item's equipment type. */
  root.addEventListener("dragover", function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    root.classList.add("clothing-loadout--drop-hover");
  });
  root.addEventListener("dragleave", function (e) {
    if (isLeavingNode(root, e.relatedTarget)) {
      root.classList.remove("clothing-loadout--drop-hover");
    }
  });
  root.addEventListener("drop", function (e) {
    e.preventDefault();
    root.classList.remove("clothing-loadout--drop-hover");
    let name = e.dataTransfer.getData("application/x-windforge-item-name");
    if (!name) name = e.dataTransfer.getData("text/plain");
    name = (name || "").trim();
    if (!name) return;
    const item = getItemByName(name);
    if (!item || item.objectType !== opts.clothingObjectType) return;
    const slotForItem = getClothingSlotId(item);
    if (!slotForItem) return;
    setSlot(slotForItem, name);
  });

  /** @type {HTMLButtonElement[]} */
  const tabBtns = [];

  function currentLoadout() {
    return loadouts[activeTab];
  }

  function setSlot(slotId, itemNameOrNull) {
    const L = currentLoadout();
    L[slotId] = itemNameOrNull && String(itemNameOrNull) ? String(itemNameOrNull) : null;
    saveToStorage();
    refreshSlotsAndTotals();
  }

  /**
   * Min width for `.clothing-loadout__slot-name` so the longest clothing display name (and stale
   * `name + " (missing)"`) fits on one line at the slot name font size.
   */
  function updatePlannerSlotNameMinWidth() {
    const sample = slotNameEls[SLOT_IDS[0]];
    if (!sample) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.font = getComputedStyle(sample).font || "12px system-ui";
    let maxPx = 0;
    const cloth = clothingItems();
    for (let i = 0; i < cloth.length; i++) {
      const t = displayName(cloth[i]) || "";
      if (!t) continue;
      const w = ctx.measureText(t).width;
      if (w > maxPx) maxPx = w;
    }
    const L = currentLoadout();
    for (let s = 0; s < SLOT_IDS.length; s++) {
      const nm = L[SLOT_IDS[s]];
      if (!nm || getItemByName(nm)) continue;
      const t = nm + " (missing)";
      const w = ctx.measureText(t).width;
      if (w > maxPx) maxPx = w;
    }
    const padded = Math.max(120, Math.ceil(maxPx) + 12);
    root.style.setProperty("--clothing-loadout-slot-name-min-px", padded + "px");
  }

  function refreshSlotVisual(slotId) {
    const name = currentLoadout()[slotId];
    const wrap = slotIconWraps[slotId];
    const nameEl = slotNameEls[slotId];
    if (!name) {
      nameEl.textContent = "";
      nameEl.classList.remove("clothing-loadout__slot-name--missing");
      renderSlotIcon(wrap, null);
      return;
    }
    const item = getItemByName(name);
    if (item) {
      nameEl.textContent = displayName(item);
      nameEl.classList.remove("clothing-loadout__slot-name--missing");
      renderSlotIcon(wrap, item);
    } else {
      nameEl.textContent = name + " (missing)";
      nameEl.classList.add("clothing-loadout__slot-name--missing");
      renderSlotIcon(wrap, null);
    }
  }

  function refreshSlotsAndTotals() {
    for (let s = 0; s < SLOT_IDS.length; s++) {
      refreshSlotVisual(SLOT_IDS[s]);
    }
    updatePlannerSlotNameMinWidth();

    const L = currentLoadout();
    const sums = sumClothingLoadoutStats(L, getItemByName);
    const items = clothingItems();
    const measureEl = statTableBody;
    const metrics = measureClothingLoadoutColumnMetrics(
      items,
      CLOTHING_STAT_DEFS,
      getClothingStatValueForColumnDef,
      {
        measureFontFromEl: measureEl,
        footerSumByColId: sums,
        theoreticalMaxSumByColId: theoreticalMaxSumByColIdForLoadout(),
      }
    );
    const decimalsById = metrics.decimalsById;
    const widthById = metrics.widthById;

    const slotW = measureSlotColumnWidthPx(measureEl) + "px";
    headCols.colSlot.style.width = slotW;
    bodyCols.colSlot.style.width = slotW;
    for (let r = 0; r < CLOTHING_STAT_DEFS.length; r++) {
      const id = CLOTHING_STAT_DEFS[r].id;
      const w = widthById[id] + "px";
      const h = headCols.colByStatId[id];
      const b = bodyCols.colByStatId[id];
      if (h) h.style.width = w;
      if (b) b.style.width = w;
    }
    statTbody.replaceChildren();
    statTfoot.replaceChildren();

    for (let s = 0; s < CLOTHING_SLOTS.length; s++) {
      const sid = CLOTHING_SLOTS[s].id;
      const slotDef = CLOTHING_SLOTS[s];
      const nm = L[sid];
      const item = nm ? getItemByName(nm) : null;

      const tr = document.createElement("tr");
      const thSlot = document.createElement("th");
      thSlot.className = "clothing-loadout__td-slot";
      thSlot.setAttribute("scope", "row");
      thSlot.textContent = slotDef.label;
      tr.appendChild(thSlot);

      for (let r = 0; r < CLOTHING_STAT_DEFS.length; r++) {
        const colDef = CLOTHING_STAT_DEFS[r];
        const dec = decimalsById[colDef.id];
        const td = document.createElement("td");
        td.className = "num clothing-loadout__td-num";
        td.textContent = item ? cellTextForClothingStat(item, colDef, dec) : "";
        tr.appendChild(td);
      }
      statTbody.appendChild(tr);
    }

    const trFoot = document.createElement("tr");
    const thSumLabel = document.createElement("th");
    thSumLabel.className = "clothing-loadout__td-slot clothing-loadout__tf-sum-label";
    thSumLabel.setAttribute("scope", "row");
    thSumLabel.textContent = "Sum";
    thSumLabel.title = "Sum across the five slots for each stat";
    trFoot.appendChild(thSumLabel);

    for (let r = 0; r < CLOTHING_STAT_DEFS.length; r++) {
      const colDef = CLOTHING_STAT_DEFS[r];
      const dec = decimalsById[colDef.id];
      const n = sums[colDef.id];
      const td = document.createElement("td");
      td.className = "num clothing-loadout__td-num clothing-loadout__tf-sum";
      td.textContent = formatCatalogStatNumber(n, { hideZero: false, decimals: dec });
      if (colDef.id === "clothAirDrain" && typeof n === "number" && n > 0) {
        td.classList.add("clothing-loadout__tf-sum--air");
      }
      trFoot.appendChild(td);
    }
    statTfoot.appendChild(trFoot);
  }

  function setActiveTab(idx) {
    activeTab = idx;
    for (let i = 0; i < tabBtns.length; i++) {
      tabBtns[i].classList.toggle("clothing-loadout__tab--active", i === idx);
      tabBtns[i].setAttribute("aria-pressed", i === idx ? "true" : "false");
    }
    saveToStorage();
    refreshSlotsAndTotals();
  }

  for (let t = 0; t < 5; t++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "clothing-loadout__tab";
    b.textContent = "Loadout " + String(t + 1);
    b.setAttribute("aria-pressed", "false");
    const idx = t;
    b.addEventListener("click", function () {
      setActiveTab(idx);
    });
    tabBtns.push(b);
    tabs.appendChild(b);
  }

  for (let s = 0; s < SLOT_IDS.length; s++) {
    const sid = SLOT_IDS[s];
    slotClearBtns[sid].addEventListener("click", function () {
      setSlot(sid, null);
    });
  }

  optBtn.addEventListener("click", function () {
    const statId = optSelect.value;
    const optimal = computeOptimalLoadoutByStat(clothingItems(), statId);
    const L = currentLoadout();
    for (let s = 0; s < SLOT_IDS.length; s++) {
      const id = SLOT_IDS[s];
      L[id] = optimal[id];
    }
    saveToStorage();
    refreshSlotsAndTotals();
  });

  loadFromStorage();
  setActiveTab(activeTab);

  return {
    refresh: refreshSlotsAndTotals,
  };
}
