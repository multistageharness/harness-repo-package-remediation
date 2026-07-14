/**
 * ui.js — tiny DOM builders (no framework, no innerHTML for dynamic values —
 * text lands via textContent, so API data can't inject markup).
 */

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, String(value));
  }
  node.append(...children.flat().filter(Boolean));
  return node;
}

export function fmtJson(value) {
  return JSON.stringify(value, null, 2);
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}
