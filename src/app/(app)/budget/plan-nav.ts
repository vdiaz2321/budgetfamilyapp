// Tab from a plan cell should land on the next plan cell, not on the
// Actual/Remaining/% buttons that sit between them in DOM order — entering a
// month's budget is a single top-to-bottom pass down one column. Every
// editable plan amount on the board (category rows, subscriptions, irregular
// bills) opts in with `data-plan-nav`, so one Tab run walks them all in list
// order; collapsed groups and hidden cells simply aren't in the list.
export function focusAdjacentPlan(current: HTMLInputElement, direction: 1 | -1) {
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement>("input[data-plan-nav]"),
  ).filter((el) => !el.disabled && !el.readOnly && el.offsetParent !== null);
  const index = inputs.indexOf(current);
  if (index === -1) return false;
  const next = inputs[index + direction];
  if (!next) return false;
  // Focusing fires the current input's blur, which saves it if it changed.
  next.focus();
  next.select();
  return true;
}

export function planNavKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key !== "Tab") return;
  if (focusAdjacentPlan(e.currentTarget, e.shiftKey ? -1 : 1)) e.preventDefault();
}
