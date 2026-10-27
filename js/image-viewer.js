import { safeHref } from "./content-renderer.js";

const MAX_ZOOM = 8;
const clamp = (value, limit) => limit ? Math.max(-limit, Math.min(limit, value)) : 0;

// Keep zoomed images inside the viewing area and preserve the point under the cursor.
export function imageView(state, zoom, viewport, point = { x: 0, y: 0 }) {
  const next = Math.max(1, Math.min(MAX_ZOOM, zoom));
  const ratio = next / state.zoom;
  return {
    ...state, zoom: next,
    x: clamp(point.x - (point.x - state.x) * ratio, Math.max(0, (state.width * next - viewport.width) / 2)),
    y: clamp(point.y - (point.y - state.y) * ratio, Math.max(0, (state.height * next - viewport.height) / 2)),
  };
}

export function attachImageViewer({ document, window }) {
  let dialog, stage, image, status, loading, zoomOut, zoomIn, title;
  let state = { width: 0, height: 0, zoom: 1, x: 0, y: 0 };
  let opener, previousFocus, drag = null, suppressStageClick = false;
  const listeners = [];
  const on = (target, name, callback, options) => {
    target.addEventListener(name, callback, options);
    listeners.push(() => target.removeEventListener(name, callback, options));
  };
  const viewport = () => stage.getBoundingClientRect();
  const paint = () => {
    image.style.width = `${state.width}px`;
    image.style.height = `${state.height}px`;
    image.style.transform = `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) scale(${state.zoom})`;
    status.textContent = `${Math.round(state.zoom * 100)}%`;
    zoomOut.disabled = state.zoom <= 1 || !state.width;
    zoomIn.disabled = state.zoom >= MAX_ZOOM || !state.width;
    stage.dataset.zoomed = String(state.zoom > 1);
  };
  const zoom = (value, point) => {
    if (!state.width) return;
    state = imageView(state, value, viewport(), point);
    paint();
  };
  const fit = () => {
    if (!dialog?.open || !image.naturalWidth || !image.naturalHeight) return;
    const bounds = viewport();
    const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight, 1);
    state = { width: image.naturalWidth * scale, height: image.naturalHeight * scale, zoom: 1, x: 0, y: 0 };
    image.hidden = false;
    loading.hidden = true;
    paint();
  };
  const close = () => { if (dialog?.open) dialog.close(); };
  const create = () => {
    dialog = document.createElement("dialog");
    dialog.className = "image-viewer";
    dialog.setAttribute("aria-labelledby", "image-viewer-title");
    dialog.setAttribute("aria-describedby", "image-viewer-help");
    const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    dialog.innerHTML = `<div class="image-viewer-shell">
      <div class="image-viewer-caption"><span>Reference image</span><h2 class="image-viewer-title" id="image-viewer-title"></h2></div>
      <button type="button" data-image-close aria-label="Close image viewer" title="Close (Escape)" autofocus>${icon('<path d="m6 6 12 12M6 18 18 6"/>')}</button>
      <div class="image-viewer-stage"><img alt="" draggable="false" hidden><p class="image-viewer-loading" role="status">Loading image…</p></div>
      <div class="image-viewer-controls" role="group" aria-label="Image zoom">
        <button type="button" data-image-out aria-label="Zoom out" title="Zoom out (−)">${icon('<path d="M5 12h14"/>')}</button>
        <output class="image-viewer-zoom" aria-live="polite">100%</output>
        <button type="button" data-image-in aria-label="Zoom in" title="Zoom in (+)">${icon('<path d="M5 12h14M12 5v14"/>')}</button>
        <span class="image-viewer-divider" aria-hidden="true"></span>
        <button type="button" data-image-fit aria-label="Fit image" title="Fit image (0)">${icon('<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>')}<span>Fit</span></button>
      </div>
      <p class="image-viewer-help" id="image-viewer-help">Scroll to zoom <span>·</span> Drag to pan <span>·</span> <kbd>Esc</kbd> to close</p>
    </div>`;
    document.body.append(dialog);
    stage = dialog.querySelector(".image-viewer-stage");
    image = stage.querySelector("img");
    status = dialog.querySelector(".image-viewer-zoom");
    title = dialog.querySelector(".image-viewer-title");
    loading = dialog.querySelector(".image-viewer-loading");
    zoomOut = dialog.querySelector("[data-image-out]");
    zoomIn = dialog.querySelector("[data-image-in]");
    on(zoomOut, "click", () => zoom(state.zoom / 1.25));
    on(zoomIn, "click", () => zoom(state.zoom * 1.25));
    on(dialog.querySelector("[data-image-fit]"), "click", fit);
    on(dialog.querySelector("[data-image-close]"), "click", close);
    on(image, "load", fit);
    on(image, "error", () => {
      image.hidden = true;
      state = { width: 0, height: 0, zoom: 1, x: 0, y: 0 };
      paint();
      loading.hidden = false;
      loading.textContent = "This image could not be loaded. Close the viewer and try again.";
    });
    on(dialog, "close", () => {
      drag = null;
      stage.classList.remove("is-dragging");
      document.documentElement.classList.remove("image-viewer-open");
      const focus = opener?.getClientRects().length ? opener : previousFocus;
      if (focus?.isConnected && focus.getClientRects().length) focus.focus({ preventScroll: true });
    });
    on(dialog, "click", event => {
      const wasPanning = suppressStageClick;
      suppressStageClick = false;
      if (wasPanning && event.target === stage) return;
      if (event.target === dialog || event.target === stage) close();
    });
    on(stage, "wheel", event => {
      event.preventDefault();
      const bounds = viewport();
      zoom(state.zoom * Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .002), {
        x: event.clientX - bounds.left - bounds.width / 2,
        y: event.clientY - bounds.top - bounds.height / 2,
      });
    }, { passive: false });
    on(stage, "pointerdown", event => {
      if (!drag) suppressStageClick = false;
      if (event.target !== image || state.zoom <= 1 || (event.button != null && event.button !== 0) || drag) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: state.x, startY: state.y };
      suppressStageClick = true;
      stage.setPointerCapture(event.pointerId);
      stage.classList.add("is-dragging");
      event.preventDefault();
    });
    on(stage, "pointermove", event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      state = imageView({ ...state, x: drag.startX + dx, y: drag.startY + dy }, state.zoom, viewport());
      paint();
    });
    const endDrag = () => { drag = null; stage.classList.remove("is-dragging"); };
    on(stage, "pointerup", endDrag);
    on(stage, "pointercancel", () => { endDrag(); suppressStageClick = false; });
    on(stage, "lostpointercapture", endDrag);
    on(dialog, "keydown", event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (["+", "=", "-", "0", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) event.preventDefault();
      if (event.key === "+" || event.key === "=") zoom(state.zoom * 1.25);
      if (event.key === "-") zoom(state.zoom / 1.25);
      if (event.key === "0") fit();
      const movement = { ArrowLeft: [50, 0], ArrowRight: [-50, 0], ArrowUp: [0, 50], ArrowDown: [0, -50] }[event.key];
      if (movement) {
        state = imageView({ ...state, x: state.x + movement[0], y: state.y + movement[1] }, state.zoom, viewport());
        paint();
      }
    });
  };
  const open = link => {
    const thumbnail = link.querySelector("img");
    const href = safeHref(link.getAttribute("href"));
    if (!href || !thumbnail) return false;
    if (!dialog) create();
    if (typeof dialog.showModal !== "function") return false;
    opener = link;
    previousFocus = document.activeElement;
    const preview = link.closest(".rule-preview");
    if (preview) previousFocus = document.querySelector(`[aria-controls="${preview.id}"]`) || previousFocus;
    state = { width: 0, height: 0, zoom: 1, x: 0, y: 0 };
    drag = null;
    suppressStageClick = false;
    image.hidden = true;
    image.alt = thumbnail.alt;
    title.textContent = thumbnail.alt || "Image";
    loading.textContent = "Loading image…";
    loading.hidden = false;
    paint();
    dialog.showModal();
    document.documentElement.classList.add("image-viewer-open");
    image.src = href;
    if (image.complete) fit();
    return true;
  };
  on(document, "click", event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || (event.button != null && event.button !== 0)) return;
    const link = event.target.closest?.("[data-image-viewer]");
    if (link && open(link)) event.preventDefault();
  });
  on(window, "resize", fit);
  return { open, close, destroy() { close(); listeners.forEach(remove => remove()); dialog?.remove(); } };
}

if (typeof document !== "undefined") attachImageViewer({ document, window });
