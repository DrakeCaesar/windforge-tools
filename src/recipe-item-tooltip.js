/**
 * Recipe-item-specific tooltip section.
 * Reuses existing recipe tooltip class names so it inherits current styling.
 */

function text(v, fallback = "") {
  if (v == null) return fallback;
  const s = String(v).trim();
  return s || fallback;
}

function appendRow(ul, leftText, rightText) {
  const li = document.createElement("li");
  li.className = "recipe-tooltip__row";

  const nameSpan = document.createElement("span");
  nameSpan.className = "recipe-tooltip__ing-name";
  nameSpan.textContent = leftText;
  li.appendChild(nameSpan);

  const rightSpan = document.createElement("span");
  rightSpan.className = "recipe-tooltip__ing-qty";
  rightSpan.textContent = rightText;
  li.appendChild(rightSpan);

  ul.appendChild(li);
}

/**
 * Append acquisition details for RecipeItem entries.
 * @param {HTMLElement} containerEl
 * @param {object} item
 * @param {Map<string, object>} recipeItemSourcesByItemName
 * @returns {boolean}
 */
export function appendRecipeItemTooltipSection(containerEl, item, recipeItemSourcesByItemName) {
  if (!containerEl || !item || !item.name || !recipeItemSourcesByItemName) return false;
  const src = recipeItemSourcesByItemName.get(item.name);
  if (!src || typeof src !== "object") return false;

  const acq = Array.isArray(src.acquisitionLocations) ? src.acquisitionLocations : [];
  const unlocks = Array.isArray(src.unlockRecipeScripts) ? src.unlockRecipeScripts : [];
  if (acq.length === 0 && unlocks.length === 0) return false;

  if (containerEl.childElementCount > 0) {
    const hr = document.createElement("hr");
    hr.className = "recipe-tooltip__hr";
    containerEl.appendChild(hr);
  }

  const title = document.createElement("div");
  title.className = "recipe-tooltip__title";
  title.textContent = "Recipe book acquisition";
  containerEl.appendChild(title);

  const head = document.createElement("div");
  head.className = "recipe-tooltip__head";
  head.textContent = text(src.recipeName, item.name);
  containerEl.appendChild(head);

  if (acq.length > 0) {
    const ul = document.createElement("ul");
    ul.className = "recipe-tooltip__list";
    for (let i = 0; i < acq.length; i++) {
      const row = acq[i] || {};
      const kind = text(row.kind);
      if (kind === "shop_pool") {
        appendRow(ul, "Shop pool: " + text(row.town, "unknown town"), text(row.storeItemType, ""));
      } else if (kind === "loot_pool") {
        appendRow(
          ul,
          "Loot pool: " + text(row.criteria, "TypeBasedSelectSpawner"),
          row.weight == null ? text(row.storeItemType, "") : "w=" + row.weight
        );
      } else if (kind === "tablet_turnin") {
        appendRow(ul, "Tablet turn-in", text(row.script, ""));
      } else {
        appendRow(ul, text(kind, "source"), "");
      }
    }
    containerEl.appendChild(ul);
  }

  if (unlocks.length > 0) {
    const unlockHead = document.createElement("div");
    unlockHead.className = "recipe-tooltip__head";
    unlockHead.textContent = "Unlock scripts:";
    containerEl.appendChild(unlockHead);

    const ulUnlocks = document.createElement("ul");
    ulUnlocks.className = "recipe-tooltip__list";
    for (let i = 0; i < unlocks.length; i++) {
      const row = unlocks[i] || {};
      appendRow(ulUnlocks, text(row.file, "script"), text(row.line, ""));
    }
    containerEl.appendChild(ulUnlocks);
  }

  return true;
}
