/**
 * Diagonal header label used by the main catalog table and the clothing loadout stat table.
 * @param {HTMLTableCellElement} th
 * @param {string} text
 */
export function appendDiagonalHeaderLabel(th, text) {
  const wrap = document.createElement("span");
  wrap.className = "num-diagonal-wrap";
  const label = document.createElement("span");
  label.className = "num-diagonal-label";
  const labelText = document.createElement("span");
  labelText.className = "num-diagonal-label-text";
  labelText.textContent = text;
  label.appendChild(labelText);
  wrap.appendChild(label);
  th.appendChild(wrap);
}
