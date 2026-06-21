// ---------------------------------------------------------------------------
// pdfhl.js — minimal PDF.js viewer with anchored, taggable highlights + zoom.
// No build step; lazy-loads the vendored pdf.js. Pages render at devicePixelRatio
// (crisp on HiDPI) and re-render on zoom (no raster blur). Highlight geometry is
// stored as page fractions, so it survives any scale.
//
//   const ctl = await PDFHL.open({ container, url, highlights, onSelect, onOpen });
//   ctl.render(hl)  ctl.remove(id)  ctl.scrollTo(page)  ctl.clearSelection()
//   ctl.setScale(s) / ctl.getScale() / ctl.zoom(factor)
// ---------------------------------------------------------------------------
(function () {
  const PDFJS_SRC = "assets/vendor/pdf.min.js";
  const WORKER_SRC = "assets/vendor/pdf.worker.min.js";
  let loading = null;

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = PDFJS_SRC;
      s.onload = () => {
        try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC; } catch (e) {}
        res(window.pdfjsLib);
      };
      s.onerror = () => rej(new Error("failed to load pdf.js"));
      document.head.appendChild(s);
    });
    return loading;
  }

  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

  async function open(opts) {
    const { container, url } = opts;
    const onSelect = opts.onSelect || (() => {});
    const onOpen = opts.onOpen || (() => {});
    const baseScale = opts.scale || 1.35;
    const dpr = window.devicePixelRatio || 1;
    const pdfjsLib = await loadPdfJs();

    container.classList.add("pdfhl-root");
    container.innerHTML = '<div class="pdfhl-loading">Rendering PDF…</div>';
    const pdf = await pdfjsLib.getDocument(url).promise;

    let scale = baseScale;
    let pages = {};                          // pageNum -> { div, w, h, hlLayer }
    let hls = (opts.highlights || []).slice();

    function drawHL(hl) {
      const p = pages[hl.page]; if (!p) return;
      p.hlLayer.querySelectorAll(`[data-id="${hl.id}"]`).forEach(n => n.remove());
      (hl.rects || []).forEach(r => {
        const d = el("div", "pdfhl-hl");
        d.dataset.id = hl.id;
        d.style.left = (r.x * p.w) + "px";
        d.style.top = (r.y * p.h) + "px";
        d.style.width = (r.w * p.w) + "px";
        d.style.height = (r.h * p.h) + "px";
        if (hl.color) d.style.background = hl.color;
        d.title = (hl.tag ? hl.tag + " — " : "") + (hl.body || hl.quote || "");
        d.addEventListener("click", ev => { ev.stopPropagation(); onOpen(hl); });
        p.hlLayer.appendChild(d);
      });
    }

    async function renderAll() {
      container.innerHTML = "";
      pages = {};
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale });
        const pageDiv = el("div", "pdfhl-page");
        pageDiv.style.width = viewport.width + "px";
        pageDiv.style.height = viewport.height + "px";
        pageDiv.dataset.page = i;
        const canvas = el("canvas");
        canvas.width = Math.floor(viewport.width * dpr);     // device pixels (sharp)
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = viewport.width + "px";          // CSS pixels
        canvas.style.height = viewport.height + "px";
        pageDiv.appendChild(canvas);
        const textLayer = el("div", "pdfhl-textlayer");
        textLayer.style.setProperty("--scale-factor", scale);
        pageDiv.appendChild(textLayer);
        const hlLayer = el("div", "pdfhl-hl-layer");
        pageDiv.appendChild(hlLayer);
        container.appendChild(pageDiv);
        pages[i] = { div: pageDiv, w: viewport.width, h: viewport.height, hlLayer };

        const rc = { canvasContext: canvas.getContext("2d"), viewport };
        if (dpr !== 1) rc.transform = [dpr, 0, 0, dpr, 0, 0];
        await page.render(rc).promise;
        try {
          const tc = await page.getTextContent();
          await pdfjsLib.renderTextLayer({
            textContentSource: tc, textContent: tc, container: textLayer, viewport, textDivs: []
          }).promise;
        } catch (e) { /* selection just won't work on this page */ }
      }
      hls.forEach(drawHL);
    }

    await renderAll();

    container.addEventListener("mouseup", () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const start = range.startContainer;
      const pageEl = (start.nodeType === 1 ? start : start.parentElement)?.closest(".pdfhl-page");
      if (!pageEl || !container.contains(pageEl)) return;
      const pageNum = parseInt(pageEl.dataset.page, 10);
      const pr = pageEl.getBoundingClientRect();
      const inside = rc => {
        const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
        return cx >= pr.left && cx <= pr.right && cy >= pr.top && cy <= pr.bottom;
      };
      const list = [...range.getClientRects()].filter(rc => rc.width > 1 && rc.height > 1 && inside(rc));
      if (!list.length) return;
      const rects = list.map(rc => ({
        x: (rc.left - pr.left) / pr.width, y: (rc.top - pr.top) / pr.height,
        w: rc.width / pr.width, h: rc.height / pr.height
      }));
      const last = list[list.length - 1];
      onSelect({ page: pageNum, rects, quote: sel.toString().trim(), anchor: { x: last.right, y: last.bottom } });
    });

    return {
      render(hl) { const i = hls.findIndex(h => h.id === hl.id); if (i >= 0) hls[i] = hl; else hls.push(hl); drawHL(hl); },
      remove(id) { hls = hls.filter(h => h.id !== id); container.querySelectorAll(`.pdfhl-hl[data-id="${id}"]`).forEach(n => n.remove()); },
      scrollTo(page) { if (pages[page]) pages[page].div.scrollIntoView({ behavior: "smooth", block: "start" }); },
      clearSelection() { const s = window.getSelection(); if (s) s.removeAllRanges(); },
      getScale() { return scale / baseScale; },              // 1.0 = "100%"
      async setScale(rel) {                                  // rel relative to base (fit) scale
        const frac = container.scrollHeight ? container.scrollTop / container.scrollHeight : 0;
        scale = Math.max(0.5, Math.min(4, baseScale * rel));
        await renderAll();
        container.scrollTop = frac * container.scrollHeight; // keep roughly the same spot
      },
      zoom(factor) { return this.setScale(Math.max(0.5, Math.min(4, (scale / baseScale) * factor))); },
      numPages: pdf.numPages
    };
  }

  window.PDFHL = { open };
})();
