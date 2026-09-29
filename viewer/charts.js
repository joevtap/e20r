/**
 * Chart primitives for the viewer: horizontal bars, a column histogram and
 * a line trend with a crosshair. Dependency-free DOM builders; every label
 * goes through `textContent` (labels are repository and symbol names, i.e.
 * untrusted data). Values always stay readable without hovering: bars and
 * columns are direct-labeled, and the tooltip only adds context.
 *
 * Exposed as `window.Viz.charts`; `window.Viz.h` is the DOM helper.
 */
(function () {
  "use strict";

  const Viz = (window.Viz = window.Viz || {});

  /** `h("div", { class: "x", onClick }, child, "text", ...)`: children are nodes or text. */
  const h = (tag, attrs, ...children) => {
    const node =
      tag === "svg" || attrs?.svg
        ? document.createElementNS("http://www.w3.org/2000/svg", tag)
        : document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false || key === "svg") continue;
      if (key.startsWith("on") && typeof value === "function")
        node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === "dataset") Object.assign(node.dataset, value);
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child === undefined || child === null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  };
  const s = (tag, attrs, ...children) => h(tag, { ...attrs, svg: true }, ...children);
  Viz.h = h;

  /**
   * `element.replaceChildren` with `h`'s child rules: nested arrays are
   * flattened and `null` / `undefined` / `false` are skipped (the native
   * method would render them as the text "null").
   */
  Viz.fill = (element, ...children) => {
    const holder = h("div", null, ...children);
    element.replaceChildren(...holder.childNodes);
    return element;
  };

  // ---- tooltip: one element, shown on hover and on keyboard focus ----

  const tooltip = () => document.getElementById("tooltip");

  /** Content: `{ value, label, rows?: [{ value, label, series }] }`. */
  const renderTip = (tip) =>
    tip.rows
      ? tip.rows.map((row) =>
          h(
            "div",
            { class: "tip-row" },
            h("i", { style: `background:var(--${row.series})` }),
            h("span", { class: "tip-value" }, row.value),
            h("span", { class: "tip-label" }, row.label),
          ),
        )
      : [
          h("div", { class: "tip-value" }, tip.value),
          tip.label ? h("div", { class: "tip-label" }, tip.label) : null,
        ];

  const place = (element, x, y) => {
    const box = element.getBoundingClientRect();
    const left = Math.min(window.innerWidth - box.width - 8, x + 14);
    const top = y + 16 + box.height > window.innerHeight ? y - box.height - 12 : y + 16;
    element.style.left = `${Math.max(8, left)}px`;
    element.style.top = `${Math.max(8, top)}px`;
  };

  Viz.showTip = (tip, x, y) => {
    const element = tooltip();
    element.replaceChildren(...renderTip(tip));
    element.hidden = false;
    place(element, x, y);
  };
  Viz.hideTip = () => {
    tooltip().hidden = true;
  };

  /** Makes `node` show `tip` on hover and focus; `onClick` makes it activatable. */
  const interactive = (node, tip, onClick) => {
    node.setAttribute("tabindex", "0");
    node.addEventListener("pointermove", (event) => Viz.showTip(tip, event.clientX, event.clientY));
    node.addEventListener("pointerleave", Viz.hideTip);
    // Keyboard focus only: focus restored after a click or a closed drawer
    // must not leave a tooltip hanging over the page.
    node.addEventListener("focus", () => {
      if (!node.matches(":focus-visible")) return;
      const box = node.getBoundingClientRect();
      Viz.showTip(tip, box.left + box.width / 2, box.bottom - 10);
    });
    node.addEventListener("blur", Viz.hideTip);
    if (onClick) {
      node.dataset.clickable = "";
      node.setAttribute("role", "button");
      node.addEventListener("click", () => {
        Viz.hideTip();
        onClick();
      });
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      });
    }
    return node;
  };

  const card = (spec, body) =>
    h(
      "section",
      { class: `card${spec.wide ? " wide" : ""}` },
      h("h3", null, spec.title),
      spec.subtitle ? h("p", { class: "sub" }, spec.subtitle) : null,
      body,
    );

  const empty = (text) => h("p", { class: "empty" }, text || "No data for the current filters.");

  /**
   * Horizontal bars, one series: `{ title, subtitle, rows: [{ label, value,
   * display, tip?, onClick? }], max? }`. Rows keep the caller's order.
   */
  const bars = (spec) => {
    const rows = spec.rows || [];
    if (rows.length === 0) return card(spec, empty(spec.empty));
    const max = spec.max ?? Math.max(...rows.map((row) => row.value), 0);
    return card(
      spec,
      h(
        "div",
        { class: "bars", role: "list" },
        rows.map((row) => {
          const width = max > 0 ? (row.value / max) * 100 : 0;
          const node = h(
            "div",
            { class: "bar", role: "listitem", "aria-label": `${row.label}: ${row.display}` },
            h("span", { class: "bar-label", title: row.label }, row.label),
            h(
              "span",
              { class: "bar-track" },
              h("span", { class: "bar-fill", style: `width:${width.toFixed(2)}%` }),
            ),
            h("span", { class: "bar-value" }, row.display),
          );
          return interactive(
            node,
            row.tip || { value: row.display, label: row.label },
            row.onClick,
          );
        }),
      ),
    );
  };

  /** Vertical columns in the given order (a histogram's bins): `{ bins: [{ label, value, display, tip? }] }`. */
  const columns = (spec) => {
    const bins = spec.bins || [];
    if (bins.every((bin) => bin.value === 0)) return card(spec, empty(spec.empty));
    const max = Math.max(...bins.map((bin) => bin.value), 1);
    return card(
      spec,
      h(
        "div",
        { class: "columns" },
        bins.map((bin) =>
          interactive(
            h(
              "div",
              { class: "col", "aria-label": `${bin.label}: ${bin.display}` },
              h("div", { class: "col-value" }, bin.value > 0 ? bin.display : ""),
              h("div", {
                class: "col-bar",
                style: `height:${bin.value > 0 ? Math.max(2, (bin.value / max) * 100).toFixed(2) : 0}%`,
              }),
              h("div", { class: "col-label" }, bin.label),
            ),
            bin.tip || { value: bin.display, label: bin.label },
          ),
        ),
      ),
    );
  };

  /**
   * Line trend on one 0..1 axis (ratios): `{ series: [{ label, className,
   * points: [{ x, y }] }], format }`. A crosshair snaps to the nearest x and
   * the tooltip lists every series there.
   */
  const trend = (spec) => {
    const series = spec.series.filter((line) => line.points.length > 0);
    const xs = series[0]?.points.map((point) => point.x) || [];
    if (xs.length < 2) return card(spec, empty(spec.empty));
    const width = 640;
    const height = 200;
    const pad = { top: 10, right: 12, bottom: 26, left: 44 };
    const maxY = Math.max(0.01, ...series.flatMap((line) => line.points.map((point) => point.y)));
    const top = Math.min(1, Math.ceil((maxY * 1.15) / 0.05) * 0.05);
    const x = (index) => pad.left + (index / (xs.length - 1)) * (width - pad.left - pad.right);
    const y = (value) => height - pad.bottom - (value / top) * (height - pad.top - pad.bottom);
    const ticks = [0, top / 2, top];

    const crosshair = s("line", {
      class: "crosshair",
      y1: pad.top,
      y2: height - pad.bottom,
      visibility: "hidden",
    });
    const svg = s(
      "svg",
      { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": spec.title },
      ticks.map((tick) => [
        s("line", {
          class: "gridline",
          x1: pad.left,
          x2: width - pad.right,
          y1: y(tick),
          y2: y(tick),
        }),
        s(
          "text",
          { class: "axis-label", x: pad.left - 8, y: y(tick) + 4, "text-anchor": "end" },
          spec.format(tick),
        ),
      ]),
      xs.map((label, index) =>
        index === 0 || index === xs.length - 1 || xs.length <= 8
          ? s(
              "text",
              {
                class: "axis-label",
                x: x(index),
                y: height - 8,
                "text-anchor": index === 0 ? "start" : index === xs.length - 1 ? "end" : "middle",
              },
              label,
            )
          : null,
      ),
      crosshair,
      series.map((line) => [
        s("polyline", {
          class: `line ${line.className}`,
          points: line.points
            .map((point, index) => `${x(index).toFixed(1)},${y(point.y).toFixed(1)}`)
            .join(" "),
        }),
        line.points.map((point, index) =>
          s("circle", { class: `dot ${line.className}`, cx: x(index), cy: y(point.y), r: 4 }),
        ),
      ]),
    );

    const nearest = (event) => {
      const box = svg.getBoundingClientRect();
      const px = ((event.clientX - box.left) / box.width) * width;
      return Math.max(
        0,
        Math.min(
          xs.length - 1,
          Math.round(((px - pad.left) / (width - pad.left - pad.right)) * (xs.length - 1)),
        ),
      );
    };
    svg.addEventListener("pointermove", (event) => {
      const index = nearest(event);
      crosshair.setAttribute("x1", x(index));
      crosshair.setAttribute("x2", x(index));
      crosshair.setAttribute("visibility", "visible");
      Viz.showTip(
        {
          rows: [
            ...series.map((line) => ({
              value: spec.format(line.points[index].y),
              label: line.label,
              series: line.className,
            })),
            { value: "", label: xs[index], series: "axis" },
          ],
        },
        event.clientX,
        event.clientY,
      );
    });
    svg.addEventListener("pointerleave", () => {
      crosshair.setAttribute("visibility", "hidden");
      Viz.hideTip();
    });

    const legend = h(
      "div",
      { class: "legend" },
      series.map((line) =>
        h("span", null, h("i", { style: `background:var(--${line.className})` }), line.label),
      ),
    );
    return card(spec, h("div", { class: "trend" }, svg, legend));
  };

  Viz.charts = { bars, columns, trend, card, empty, interactive };
})();
