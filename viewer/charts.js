/**
 * Chart primitives: tiny dependency-free bars, histograms and trends.
 *
 * Everything renders as plain HTML/CSS (with one inline SVG for trends), so
 * the viewer stays double-clickable. All values are escaped; charts take
 * plain numbers and label strings only.
 *
 * Charts are registered on `window.Viz.charts` and rendered by app.js.
 */
(function () {
  "use strict";

  const Viz = (window.Viz = window.Viz || {});

  const escapeHtml = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );

  const formatNumber = (value) =>
    Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });

  /** Renders a labelled bar row. */
  const barRow = (label, value, widthPercent, hint, formatted) =>
    `<div class="bar-row">` +
    `<div class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>` +
    `<div class="bar-track"><div class="bar-fill" style="width:${Math.max(1, widthPercent).toFixed(1)}%"></div></div>` +
    `<div class="bar-value"${hint ? ` title="${escapeHtml(hint)}"` : ""}>${escapeHtml(formatted)}</div>` +
    `</div>`;

  /**
   * Horizontal bars: `{ title, subtitle, rows: [{ label, value, hint? }],
   * format? }`. Sorted by value (descending) by the caller.
   */
  Viz.charts = Viz.charts || {};

  Viz.charts.bars = function bars(container, spec) {
    const rows = spec.rows || [];
    const max = Math.max(1, ...rows.map((row) => row.value));
    const format = spec.format || formatNumber;
    const body =
      rows.length === 0
        ? `<p class="chart-empty">no data</p>`
        : rows
            .map((row) =>
              barRow(
                row.label,
                row.value,
                (row.value / max) * 100,
                row.hint,
                format(row.value, row),
              ),
            )
            .join("");
    container.innerHTML =
      `<h3>${escapeHtml(spec.title)}</h3>` +
      (spec.subtitle ? `<p class="chart-sub">${escapeHtml(spec.subtitle)}</p>` : "") +
      `<div class="chart-body">${body}</div>`;
  };

  /**
   * Vertical histogram: `{ title, subtitle, bins: [{ label, count, hint? }],
   * format? }`. Bins keep their given order (that is the x axis).
   */
  Viz.charts.histogram = function histogram(container, spec) {
    const bins = spec.bins || [];
    const max = Math.max(1, ...bins.map((bin) => bin.count));
    const format = spec.format || formatNumber;
    const body =
      bins.length === 0
        ? `<p class="chart-empty">no data</p>`
        : `<div class="histogram">` +
          bins
            .map(
              (bin) =>
                `<div class="hist-col">` +
                `<div class="hist-value">${escapeHtml(format(bin.count))}</div>` +
                `<div class="hist-bar-wrap"><div class="hist-bar" style="height:${Math.max(bin.count > 0 ? 3 : 0, (bin.count / max) * 100).toFixed(1)}%" title="${escapeHtml(bin.hint || `${bin.label}: ${format(bin.count)}`)}"></div></div>` +
                `<div class="hist-label">${escapeHtml(bin.label)}</div>` +
                `</div>`,
            )
            .join("") +
          `</div>`;
    container.innerHTML =
      `<h3>${escapeHtml(spec.title)}</h3>` +
      (spec.subtitle ? `<p class="chart-sub">${escapeHtml(spec.subtitle)}</p>` : "") +
      `<div class="chart-body">${body}</div>`;
  };

  /**
   * Multi-series trend over runs: `{ title, subtitle, series: [{ label,
   * points: [{ x, y }] }], format? }`. `x` is a display label (run date),
   * `y` a number. Rendered as an inline SVG line chart with dots.
   */
  Viz.charts.trend = function trend(container, spec) {
    const series = (spec.series || []).filter((s) => (s.points || []).length > 0);
    const format = spec.format || ((value) => `${(value * 100).toFixed(1)}%`);
    const width = 460;
    const height = 150;
    const pad = { top: 8, right: 34, bottom: 22, left: 46 };

    if (series.length === 0) {
      container.innerHTML =
        `<h3>${escapeHtml(spec.title)}</h3>` +
        (spec.subtitle ? `<p class="chart-sub">${escapeHtml(spec.subtitle)}</p>` : "") +
        `<div class="chart-body"><p class="chart-empty">no data</p></div>`;
      return;
    }

    const xs = [...new Set(series.flatMap((s) => s.points.map((p) => String(p.x))))];
    const maxY = Math.max(0.0001, ...series.flatMap((s) => s.points.map((p) => Number(p.y) || 0)));
    const xOf = (x) =>
      pad.left +
      (xs.length === 1
        ? (width - pad.left - pad.right) / 2
        : (xs.indexOf(String(x)) / (xs.length - 1)) * (width - pad.left - pad.right));
    const yOf = (y) =>
      height - pad.bottom - ((Number(y) || 0) / maxY) * (height - pad.top - pad.bottom);

    const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];
    const paths = series
      .map((s, index) => {
        const points = s.points.map((p) => `${xOf(p.x).toFixed(1)},${yOf(p.y).toFixed(1)}`);
        const dots = s.points
          .map(
            (p) =>
              `<circle cx="${xOf(p.x).toFixed(1)}" cy="${yOf(p.y).toFixed(1)}" r="3" fill="${colors[index % colors.length]}"><title>${escapeHtml(`${s.label} · ${p.x}: ${format(p.y)}`)}</title></circle>`,
          )
          .join("");
        return (
          `<polyline points="${points.join(" ")}" fill="none" stroke="${colors[index % colors.length]}" stroke-width="2"/>` +
          dots
        );
      })
      .join("");

    const xLabels = xs
      .map(
        (x) =>
          `<text x="${xOf(x).toFixed(1)}" y="${height - 6}" text-anchor="middle" class="trend-x">${escapeHtml(String(x).slice(0, 11))}</text>`,
      )
      .join("");
    const yLabels = [0, maxY]
      .map(
        (y) =>
          `<text x="${pad.left - 6}" y="${(yOf(y) + 3).toFixed(1)}" text-anchor="end" class="trend-y">${escapeHtml(format(y))}</text>`,
      )
      .join("");

    const legend = series
      .map(
        (s, index) =>
          `<span class="trend-legend-item"><i style="background:${colors[index % colors.length]}"></i>${escapeHtml(s.label)}</span>`,
      )
      .join("");

    container.innerHTML =
      `<h3>${escapeHtml(spec.title)}</h3>` +
      (spec.subtitle ? `<p class="chart-sub">${escapeHtml(spec.subtitle)}</p>` : "") +
      `<div class="chart-body">` +
      `<svg viewBox="0 0 ${width} ${height}" class="trend-svg" role="img" aria-label="${escapeHtml(spec.title)}">` +
      `<line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" class="trend-axis"/>` +
      yLabels +
      xLabels +
      paths +
      `</svg>` +
      `<div class="trend-legend">${legend}</div>` +
      `</div>`;
  };
})();
