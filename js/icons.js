/**
 * Jednobojne linijske ikone (SVG sprite u index.html, #i-<ime>).
 * Boja dolazi iz currentColor, veličina iz font-size (1em).
 */
function icon(name, extraClass) {
  return `<svg class="ic${extraClass ? ' ' + extraClass : ''}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
}
