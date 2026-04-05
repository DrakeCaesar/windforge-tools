/**
 * Clothing loadout planner: five body slots (head, torso, hands, legs, feet), stat totals,
 * nine saved loadout presets (localStorage), and per-slot optimization for one chosen stat.
 */

import { appendDiagonalHeaderLabel } from "./diagonal-table-header.js";
import { formatCatalogStatNumber } from "./catalog-stat-format.js";
import { measureClothingLoadoutColumnMetrics } from "./catalog-stat-layout.js";
import {
  getClothingStatValueForColumnDef,
  itemCatalogSortPermutation as SP,
} from "./sort-permutation-core.js";

/** @typedef {{ id: string, label: string, folders: string[] }} ClothingSlotDef */

/** Preset tabs shown in a 3×3 grid under the stat table. */
const LOADOUT_PRESET_COUNT = 9;

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

/** Wider last stat col so default diagonal header (`left: 50%`) fits long labels (e.g. regen). */
const LOADOUT_LAST_STAT_COL_EXTRA_PX = 13;

/** Feet-slot items never chosen by optimize (niche movement gear). */
const ANTI_GRAVITY_BOOT_NAMES = new Set([
  "AntiGravityBoots",
  "QualityAntiGravityBoots",
  "MasterCraftAntiGravityBoots",
]);

/**
 * @param {*} item
 * @returns {boolean}
 */
function shouldExcludeItemFromOptimize(item) {
  const n = item && item.name;
  if (typeof n !== "string") return false;
  return ANTI_GRAVITY_BOOT_NAMES.has(n);
}

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
  if (colDef.id === "clothAirDrain" || colDef.id === "clothTraitWeight") return a < b;
  return a > b;
}

/**
 * @param {object[]} clothingItems
 * @param {string} statColumnId — {@link CLOTHING_STAT_DEFS}[].id
 * @param {{ lockedSlots?: Record<string, boolean> }} [opts]
 * @returns {Record<string, string|null>}
 */
export function computeOptimalLoadoutByStat(clothingItems, statColumnId, opts) {
  opts = opts || {};
  const lockedSlots = opts.lockedSlots || {};
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
    if (lockedSlots[slotId]) {
      out[slotId] = null;
      continue;
    }
    let bestName = null;
    let bestVal = null;
    for (let i = 0; i < clothingItems.length; i++) {
      const it = clothingItems[i];
      if (!it || getClothingSlotId(it) !== slotId) continue;
      if (shouldExcludeItemFromOptimize(it)) continue;
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

function valuesNearlyEqual(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < 1e-9;
  }
  return a === b;
}

/**
 * @param {string} slotId
 * @param {string} statColumnId
 * @param {*} equippedItem
 * @param {object[]} clothingItems
 * @param {(item: *) => string} displayName
 */
function listItemsMatchingEquippedStatInSlot(
  slotId,
  statColumnId,
  equippedItem,
  clothingItems,
  displayName
) {
  const colDef = CLOTHING_STAT_DEFS.find(function (d) {
    return d.id === statColumnId;
  });
  if (!colDef || !equippedItem) return [];
  const vEq = getClothingStatValueForColumnDef(equippedItem, colDef);
  if (vEq == null) return [];
  const out = [];
  for (let i = 0; i < clothingItems.length; i++) {
    const it = clothingItems[i];
    if (!it || getClothingSlotId(it) !== slotId) continue;
    if (shouldExcludeItemFromOptimize(it)) continue;
    const v = getClothingStatValueForColumnDef(it, colDef);
    if (v == null) continue;
    if (valuesNearlyEqual(v, vEq)) out.push(it);
  }
  out.sort(function (a, b) {
    const da = displayName(a) || a.name || "";
    const db = displayName(b) || b.name || "";
    return da.localeCompare(db);
  });
  return out;
}

/** Slot row uses a wrap; tooltips should align to the actual `.item-icon` (img or placeholder). */
function getClothingSlotIconAnchorEl(wrapEl) {
  if (!wrapEl || typeof wrapEl.querySelector !== "function") return wrapEl;
  const icon = wrapEl.querySelector(".item-icon");
  return icon || wrapEl;
}

/** Mirrors main recipe flyout placement ({@link positionRecipeTooltipLayer} for the primary panel). */
function positionLoadoutTieTooltip(el, clientX, clientY, anchorEl) {
  const margin = 8;
  const iconGap = 4;
  const minH = 160;
  const ar =
    anchorEl &&
    anchorEl.isConnected &&
    typeof anchorEl.getBoundingClientRect === "function"
      ? anchorEl.getBoundingClientRect()
      : null;
  const refY = ar ? ar.top + ar.height / 2 : clientY;
  const below = window.innerHeight - margin - refY;
  const above = refY - margin;
  const placeBelow = below >= minH || below >= above;
  const maxH = Math.max(minH, placeBelow ? below : above);
  el.style.maxHeight = Math.floor(maxH) + "px";
  el.style.position = "fixed";
  el.style.zIndex = "10003";
  requestAnimationFrame(function () {
    if (el.hidden) return;
    const ar2 =
      anchorEl &&
      anchorEl.isConnected &&
      typeof anchorEl.getBoundingClientRect === "function"
        ? anchorEl.getBoundingClientRect()
        : null;
    const refY2 = ar2 ? ar2.top + ar2.height / 2 : clientY;
    const r = el.getBoundingClientRect();
    let x = ar2 ? ar2.right + iconGap : clientX;
    if (x + r.width > window.innerWidth - margin) {
      x = ar2
        ? Math.max(margin, ar2.left - iconGap - r.width)
        : Math.max(margin, window.innerWidth - r.width - margin);
    }
    let y = placeBelow ? refY2 : refY2 - r.height;
    const firstIconEl = el.querySelector(".recipe-tooltip__ing-icon");
    if (firstIconEl && typeof firstIconEl.getBoundingClientRect === "function") {
      const firstIconRect = firstIconEl.getBoundingClientRect();
      const firstIconCenterOffset = firstIconRect.top - r.top + firstIconRect.height / 2;
      y = refY2 - firstIconCenterOffset;
    }
    if (y + r.height > window.innerHeight - margin) {
      y = Math.max(margin, window.innerHeight - r.height - margin);
    }
    if (y < margin) y = margin;
    if (x < margin) x = margin;
    el.style.left = x + "px";
    el.style.top = y + "px";
  });
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
 *   getFilteredClothingItems?: () => object[],
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

  function emptySlotLocks() {
    /** @type {Record<string, boolean>} */
    const o = {};
    for (let i = 0; i < SLOT_IDS.length; i++) {
      o[SLOT_IDS[i]] = false;
    }
    return o;
  }

  /** @type {Record<string, string|null>[]} */
  let loadouts = [];
  /** @type {Record<string, boolean>[]} — per loadout tab; locked slots skip Optimize. */
  let loadoutSlotLocks = [];
  for (let _p = 0; _p < LOADOUT_PRESET_COUNT; _p++) {
    loadouts.push(emptyLoadout());
    loadoutSlotLocks.push(emptySlotLocks());
  }
  let activeTab = 0;
  /** @type {string | null} — last used Optimize stat (UI + tie tooltip). */
  let activeOptimizeStatId = null;

  function clothingItems() {
    if (typeof opts.getFilteredClothingItems === "function") {
      return opts.getFilteredClothingItems();
    }
    const all = getAllItems();
    const out = [];
    for (let i = 0; i < all.length; i++) {
      const it = all[i];
      if (it && it.objectType === opts.clothingObjectType) out.push(it);
    }
    return out;
  }

  /** Full catalog clothing — never filtered by the main table UI (used for one-time layout widths). */
  function allClothingItemsUnfiltered() {
    const all = getAllItems();
    const out = [];
    for (let i = 0; i < all.length; i++) {
      const it = all[i];
      if (it && it.objectType === opts.clothingObjectType) out.push(it);
    }
    return out;
  }

  /**
   * Upper bound for the Sum row: sum over slots of each slot's maximum stat (for column width).
   * @param {object[]} items
   * @returns {Record<string, number>}
   */
  function theoreticalMaxSumByColIdForItems(items) {
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

  /**
   * Upper bound using the current filtered clothing list (Optimize / tie tooltip).
   * @returns {Record<string, number>}
   */
  function theoreticalMaxSumByColIdForLoadout() {
    return theoreticalMaxSumByColIdForItems(clothingItems());
  }

  /** @type {{ decimalsById: Record<string, number>, widthById: Record<string, number> } | null} */
  let frozenPlannerStatMetrics = null;
  let frozenPlannerSlotColWidthPx = 0;

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (!p || typeof p !== "object") return;
      if (typeof p.active === "number" && p.active >= 0 && p.active < LOADOUT_PRESET_COUNT) {
        activeTab = p.active;
      }
      if (Array.isArray(p.loadouts) && p.loadouts.length >= 5) {
        for (let L = 0; L < LOADOUT_PRESET_COUNT; L++) {
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
      if (Array.isArray(p.slotLocks) && p.slotLocks.length >= 5) {
        for (let L = 0; L < LOADOUT_PRESET_COUNT; L++) {
          const row = p.slotLocks[L];
          const base = emptySlotLocks();
          if (row && typeof row === "object") {
            for (let s = 0; s < SLOT_IDS.length; s++) {
              const id = SLOT_IDS[s];
              if (row[id] === true) base[id] = true;
            }
          }
          loadoutSlotLocks[L] = base;
        }
      }
      if (typeof p.activeOptimizeStatId === "string" && p.activeOptimizeStatId) {
        const ok = CLOTHING_STAT_DEFS.some(function (d) {
          return d.id === p.activeOptimizeStatId;
        });
        activeOptimizeStatId = ok ? p.activeOptimizeStatId : null;
      } else {
        activeOptimizeStatId = null;
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
          v: 2,
          active: activeTab,
          loadouts: loadouts,
          slotLocks: loadoutSlotLocks,
          activeOptimizeStatId: activeOptimizeStatId,
        })
      );
    } catch (e) {
      /* ignore */
    }
  }

  root.innerHTML = "";
  root.classList.add("clothing-loadout");

  const tieTooltipEl = document.createElement("div");
  tieTooltipEl.className = "recipe-tooltip clothing-loadout__tie-tooltip";
  tieTooltipEl.setAttribute("role", "tooltip");
  tieTooltipEl.hidden = true;
  document.body.appendChild(tieTooltipEl);

  /** @type {HTMLElement | null} — slot icon wrap; used like recipe tooltip anchor for pointer leave. */
  let tieTooltipAnchorWrap = null;

  let tieTooltipHideTimer = null;
  function hideTieTooltip() {
    if (tieTooltipHideTimer != null) {
      clearTimeout(tieTooltipHideTimer);
      tieTooltipHideTimer = null;
    }
    tieTooltipAnchorWrap = null;
    tieTooltipEl.hidden = true;
    tieTooltipEl.innerHTML = "";
  }
  function scheduleHideTieTooltip() {
    if (tieTooltipHideTimer != null) clearTimeout(tieTooltipHideTimer);
    tieTooltipHideTimer = setTimeout(function () {
      tieTooltipHideTimer = null;
      hideTieTooltip();
    }, 120);
  }
  function cancelHideTieTooltip() {
    if (tieTooltipHideTimer != null) {
      clearTimeout(tieTooltipHideTimer);
      tieTooltipHideTimer = null;
    }
  }

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
  /** @type {Record<string, HTMLButtonElement>} */
  const slotLockBtns = {};

  function currentLoadoutLocks() {
    return loadoutSlotLocks[activeTab];
  }

  function updateLockButtonVisual(slotId) {
    const btn = slotLockBtns[slotId];
    if (!btn) return;
    const locked = !!currentLoadoutLocks()[slotId];
    btn.classList.toggle("clothing-loadout__slot-lock--locked", locked);
    btn.setAttribute("aria-pressed", locked ? "true" : "false");
    btn.title = locked ? "Slot locked — Optimize will not change this slot" : "Lock slot (Optimize will skip)";
    const openSvg =
      '<svg class="clothing-loadout__lock-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0"/></svg>';
    const shutSvg =
      '<svg class="clothing-loadout__lock-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    btn.innerHTML = locked ? shutSvg : openSvg;
  }

  function refreshAllLockButtonVisuals() {
    for (let s = 0; s < SLOT_IDS.length; s++) {
      updateLockButtonVisual(SLOT_IDS[s]);
    }
  }

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

    const actions = document.createElement("div");
    actions.className = "clothing-loadout__slot-actions";

    const lockBtn = document.createElement("button");
    lockBtn.type = "button";
    lockBtn.className = "clothing-loadout__slot-lock";
    lockBtn.setAttribute("aria-label", "Lock slot");
    lockBtn.setAttribute("aria-pressed", "false");
    const slotIdForClosure = def.id;
    lockBtn.addEventListener("click", function (e) {
      e.preventDefault();
      const locks = currentLoadoutLocks();
      locks[slotIdForClosure] = !locks[slotIdForClosure];
      updateLockButtonVisual(slotIdForClosure);
      saveToStorage();
    });

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "clothing-loadout__slot-clear";
    clearBtn.setAttribute("aria-label", "Clear " + def.label);
    clearBtn.title = "Clear " + def.label;
    clearBtn.innerHTML =
      '<svg class="clothing-loadout__clear-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

    actions.appendChild(lockBtn);
    actions.appendChild(clearBtn);

    box.appendChild(lab);
    box.appendChild(iconWrap);
    box.appendChild(nameEl);
    box.appendChild(actions);

    slotsStack.appendChild(box);
    slotEls[def.id] = box;
    slotIconWraps[def.id] = iconWrap;
    slotNameEls[def.id] = nameEl;
    slotClearBtns[def.id] = clearBtn;
    slotLockBtns[def.id] = lockBtn;

    (function bindTieTooltip(slotId, wrapEl) {
      wrapEl.addEventListener(
        "mouseenter",
        function (e) {
          cancelHideTieTooltip();
          if (!activeOptimizeStatId) {
            hideTieTooltip();
            return;
          }
          const nm = currentLoadout()[slotId];
          if (!nm) {
            hideTieTooltip();
            return;
          }
          const equipped = getItemByName(nm);
          if (!equipped) {
            hideTieTooltip();
            return;
          }
          const tied = listItemsMatchingEquippedStatInSlot(
            slotId,
            activeOptimizeStatId,
            equipped,
            clothingItems(),
            displayName
          );
          const colDef = CLOTHING_STAT_DEFS.find(function (d) {
            return d.id === activeOptimizeStatId;
          });
          if (!colDef) {
            hideTieTooltip();
            return;
          }
          const vEq = getClothingStatValueForColumnDef(equipped, colDef);
          tieTooltipEl.innerHTML = "";
          tieTooltipAnchorWrap = wrapEl;

          const title = document.createElement("div");
          title.className = "recipe-tooltip__title";
          title.textContent =
            "Same " +
            colDef.label +
            " — " +
            tied.length +
            " tie" +
            (tied.length === 1 ? "" : "s") +
            (vEq != null ? " (value " + String(vEq) + ")" : "");

          const hint = document.createElement("div");
          hint.className = "recipe-tooltip__out";
          hint.textContent = "Click a row to equip that item in this slot.";

          tieTooltipEl.appendChild(title);
          tieTooltipEl.appendChild(hint);

          const ul = document.createElement("ul");
          ul.className = "recipe-tooltip__list";
          for (let t = 0; t < tied.length; t++) {
            const it = tied[t];
            const li = document.createElement("li");
            li.className = "recipe-tooltip__row clothing-loadout__tie-row";
            li.setAttribute("role", "button");
            li.tabIndex = 0;
            li.title = "Equip " + (displayName(it) || it.name || "");
            const slotIdForRow = slotId;
            const itemRef = it;
            li.addEventListener("click", function (ev) {
              ev.preventDefault();
              ev.stopPropagation();
              setSlot(slotIdForRow, itemRef.name);
              hideTieTooltip();
            });
            li.addEventListener("keydown", function (ev) {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                setSlot(slotIdForRow, itemRef.name);
                hideTieTooltip();
              }
            });

            const iconWrapRow = document.createElement("div");
            iconWrapRow.className = "recipe-tooltip__ing-icon";
            iconWrapRow.dataset.itemName = it.name;
            renderSlotIcon(iconWrapRow, it);

            const nameSpan = document.createElement("span");
            nameSpan.className = "recipe-tooltip__ing-name";
            nameSpan.textContent = displayName(it) || it.name || "";

            li.appendChild(iconWrapRow);
            li.appendChild(nameSpan);
            ul.appendChild(li);
          }
          tieTooltipEl.appendChild(ul);
          tieTooltipEl.hidden = false;
          positionLoadoutTieTooltip(
            tieTooltipEl,
            e.clientX,
            e.clientY,
            getClothingSlotIconAnchorEl(wrapEl)
          );
        },
        { passive: true }
      );
      wrapEl.addEventListener(
        "mousemove",
        function (e) {
          if (!tieTooltipEl.hidden) {
            positionLoadoutTieTooltip(
              tieTooltipEl,
              e.clientX,
              e.clientY,
              getClothingSlotIconAnchorEl(wrapEl)
            );
          }
        },
        { passive: true }
      );
      wrapEl.addEventListener(
        "mouseleave",
        function (e) {
          const rt = e.relatedTarget;
          if (rt && tieTooltipEl.contains(rt)) return;
          scheduleHideTieTooltip();
        },
        { passive: true }
      );
    })(def.id, iconWrap);
  }

  refreshAllLockButtonVisuals();

  tieTooltipEl.addEventListener("mouseenter", cancelHideTieTooltip);
  tieTooltipEl.addEventListener("mouseleave", function (ev) {
    const rt = ev.relatedTarget;
    if (rt && tieTooltipAnchorWrap && tieTooltipAnchorWrap.contains(rt)) return;
    scheduleHideTieTooltip();
  });

  document.addEventListener(
    "dragstart",
    function () {
      hideTieTooltip();
    },
    true
  );
  window.addEventListener(
    "scroll",
    function (e) {
      // Capture-phase listener runs for every scroll (including inside this tooltip).
      // Only treat as "page scroll" when the scrolling element is not our flyout.
      const t = e.target;
      if (
        tieTooltipEl &&
        !tieTooltipEl.hidden &&
        t &&
        (t === tieTooltipEl ||
          (typeof tieTooltipEl.contains === "function" && tieTooltipEl.contains(t)))
      ) {
        return;
      }
      hideTieTooltip();
    },
    true
  );

  slotsDropZone.appendChild(slotsStack);
  slotsCol.appendChild(slotsDropZone);

  const optimizeCol = document.createElement("div");
  optimizeCol.className = "clothing-loadout__optimize-col";

  const optRow = document.createElement("div");
  optRow.className = "clothing-loadout__optimize";

  const optList = document.createElement("div");
  optList.className = "clothing-loadout__optimize-panel";
  optList.setAttribute("role", "group");
  optList.setAttribute("aria-label", "Optimize: pick best item per slot for one stat");

  const optTitle = document.createElement("div");
  optTitle.className = "clothing-loadout__panel-heading";
  optTitle.textContent = "Optimize";
  optList.appendChild(optTitle);

  /** @type {{ btn: HTMLButtonElement, statId: string }[]} */
  const optimizeOptionRefs = [];

  function updateOptimizeButtonHighlight() {
    for (let i = 0; i < optimizeOptionRefs.length; i++) {
      const ref = optimizeOptionRefs[i];
      ref.btn.classList.toggle(
        "clothing-loadout__optimize-option--active",
        ref.statId === activeOptimizeStatId
      );
    }
  }

  for (let i = 0; i < CLOTHING_STAT_DEFS.length; i++) {
    const d = CLOTHING_STAT_DEFS[i];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "object-type-dropdown__option clothing-loadout__optimize-option";
    b.textContent = d.label;
    b.title =
      "Equip the best " +
      d.label.toLowerCase() +
      " in each body slot independently (" +
      (d.id === "clothAirDrain" || d.id === "clothTraitWeight" ? "lowest" : "highest") +
      " wins; locked slots and anti-gravity boots excluded).";
    const statId = d.id;
    optimizeOptionRefs.push({ btn: b, statId: statId });
    b.addEventListener("click", function () {
      activeOptimizeStatId = statId;
      updateOptimizeButtonHighlight();
      const optimal = computeOptimalLoadoutByStat(clothingItems(), statId, {
        lockedSlots: currentLoadoutLocks(),
      });
      const L = currentLoadout();
      for (let s = 0; s < SLOT_IDS.length; s++) {
        const sid = SLOT_IDS[s];
        if (currentLoadoutLocks()[sid]) continue;
        L[sid] = optimal[sid];
      }
      saveToStorage();
      refreshSlotsAndTotals();
    });
    optList.appendChild(b);
  }

  optRow.appendChild(optList);
  optimizeCol.appendChild(optRow);

  const tableCol = document.createElement("div");
  tableCol.className = "clothing-loadout__table-col";

  const loadoutsCol = document.createElement("div");
  loadoutsCol.className = "clothing-loadout__loadouts-col";

  const loadoutsPanel = document.createElement("div");
  loadoutsPanel.className = "clothing-loadout__loadouts-panel";
  loadoutsPanel.setAttribute("role", "tablist");
  loadoutsPanel.setAttribute("aria-label", "Saved loadout presets");
  loadoutsCol.appendChild(loadoutsPanel);

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
    if (colDef.id === "clothAirDrain" || colDef.id === "clothTraitWeight") {
      th.title = colDef.label + " (lower is better)";
    }
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

  tableCol.appendChild(statsScroll);

  const tableStack = document.createElement("div");
  tableStack.className = "clothing-loadout__table-stack clothing-loadout__table-merge";
  tableStack.appendChild(tableCol);
  tableStack.appendChild(loadoutsCol);

  bodyLayout.appendChild(slotsCol);
  bodyLayout.appendChild(optimizeCol);
  bodyLayout.appendChild(tableStack);

  root.appendChild(bodyLayout);

  /** Drop only on the slots strip; slot is chosen from the item's equipment folder. */
  slotsDropZone.addEventListener("dragover", function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  slotsDropZone.addEventListener("drop", function (e) {
    e.preventDefault();
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
  /** @type {HTMLElement[][]} — per preset tab, one `.recipe-tooltip__ing-icon` wrap per body slot. */
  const loadoutTabIconWraps = [];

  for (let t = 0; t < LOADOUT_PRESET_COUNT; t++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "object-type-dropdown__option clothing-loadout__loadout-tab";
    b.setAttribute("role", "tab");
    const n = String(t + 1);
    b.setAttribute("aria-label", "Loadout " + n);
    b.title = "Loadout " + n;
    b.setAttribute("aria-selected", "false");
    b.setAttribute("aria-pressed", "false");
    const iconsRow = document.createElement("span");
    iconsRow.className = "clothing-loadout__loadout-tab-icons";
    iconsRow.setAttribute("aria-hidden", "true");
    const wraps = [];
    for (let s = 0; s < SLOT_IDS.length; s++) {
      const wrap = document.createElement("div");
      wrap.className = "recipe-tooltip__ing-icon";
      wraps.push(wrap);
      iconsRow.appendChild(wrap);
    }
    loadoutTabIconWraps.push(wraps);
    b.appendChild(iconsRow);
    const idx = t;
    b.addEventListener("click", function () {
      setActiveTab(idx);
    });
    tabBtns.push(b);
    loadoutsPanel.appendChild(b);
  }

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
   * Slot-name min width + stat column widths from the full clothing list, once (ignores catalog filters).
   */
  function computePlannerLayoutOnce() {
    const sample = slotNameEls[SLOT_IDS[0]];
    if (!sample || !statTableBody) return;
    const items = allClothingItemsUnfiltered();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.font = getComputedStyle(sample).font || "12px system-ui";
    let maxPx = 0;
    for (let i = 0; i < items.length; i++) {
      const t = displayName(items[i]) || "";
      if (!t) continue;
      const w = ctx.measureText(t).width;
      if (w > maxPx) maxPx = w;
    }
    for (let L = 0; L < LOADOUT_PRESET_COUNT; L++) {
      const preset = loadouts[L];
      for (let s = 0; s < SLOT_IDS.length; s++) {
        const nm = preset[SLOT_IDS[s]];
        if (!nm || getItemByName(nm)) continue;
        const t = nm + " (missing)";
        const w = ctx.measureText(t).width;
        if (w > maxPx) maxPx = w;
      }
    }
    const padded = Math.max(120, Math.ceil(maxPx) + 12);
    root.style.setProperty("--clothing-loadout-slot-name-min-px", padded + "px");

    const theoreticalMax = theoreticalMaxSumByColIdForItems(items);
    frozenPlannerStatMetrics = measureClothingLoadoutColumnMetrics(
      items,
      CLOTHING_STAT_DEFS,
      getClothingStatValueForColumnDef,
      {
        measureFontFromEl: statTableBody,
        footerSumByColId: null,
        theoreticalMaxSumByColId: theoreticalMax,
      }
    );
    frozenPlannerSlotColWidthPx = measureSlotColumnWidthPx(statTableBody);
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

  function refreshLoadoutTabPreviews() {
    for (let t = 0; t < LOADOUT_PRESET_COUNT; t++) {
      const preset = loadouts[t];
      const wraps = loadoutTabIconWraps[t];
      if (!wraps) continue;
      for (let s = 0; s < SLOT_IDS.length; s++) {
        const sid = SLOT_IDS[s];
        const nm = preset[sid];
        const item = nm ? getItemByName(nm) : null;
        renderSlotIcon(wraps[s], item || null);
      }
    }
  }

  function refreshSlotsAndTotals() {
    refreshAllLockButtonVisuals();
    for (let s = 0; s < SLOT_IDS.length; s++) {
      refreshSlotVisual(SLOT_IDS[s]);
    }

    const L = currentLoadout();
    const sums = sumClothingLoadoutStats(L, getItemByName);
    const metrics =
      frozenPlannerStatMetrics ||
      measureClothingLoadoutColumnMetrics(
        allClothingItemsUnfiltered(),
        CLOTHING_STAT_DEFS,
        getClothingStatValueForColumnDef,
        {
          measureFontFromEl: statTableBody,
          footerSumByColId: null,
          theoreticalMaxSumByColId: theoreticalMaxSumByColIdForItems(allClothingItemsUnfiltered()),
        }
      );
    const decimalsById = metrics.decimalsById;
    const widthById = metrics.widthById;

    const slotW =
      (frozenPlannerSlotColWidthPx ||
        measureSlotColumnWidthPx(statTableBody)) + "px";
    headCols.colSlot.style.width = slotW;
    bodyCols.colSlot.style.width = slotW;
    const lastStatIdx = CLOTHING_STAT_DEFS.length - 1;
    for (let r = 0; r < CLOTHING_STAT_DEFS.length; r++) {
      const id = CLOTHING_STAT_DEFS[r].id;
      let wPx = widthById[id];
      if (r === lastStatIdx) wPx += LOADOUT_LAST_STAT_COL_EXTRA_PX;
      const w = wPx + "px";
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
      trFoot.appendChild(td);
    }
    statTfoot.appendChild(trFoot);
    refreshLoadoutTabPreviews();
  }

  function setActiveTab(idx) {
    activeTab = idx;
    for (let i = 0; i < tabBtns.length; i++) {
      const on = i === idx;
      tabBtns[i].classList.toggle("object-type-dropdown__option--selected", on);
      tabBtns[i].setAttribute("aria-selected", on ? "true" : "false");
      tabBtns[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    saveToStorage();
    refreshSlotsAndTotals();
  }

  for (let s = 0; s < SLOT_IDS.length; s++) {
    const sid = SLOT_IDS[s];
    slotClearBtns[sid].addEventListener("click", function () {
      setSlot(sid, null);
    });
  }

  loadFromStorage();
  computePlannerLayoutOnce();
  setActiveTab(activeTab);
  updateOptimizeButtonHighlight();

  return {
    refresh: refreshSlotsAndTotals,
  };
}
