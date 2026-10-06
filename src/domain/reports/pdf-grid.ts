/**
 * Rebuilding a table from a PDF's text layer.
 *
 * A spreadsheet hands you cells. A PDF hands you fragments of text and the
 * coordinates they were painted at, and the table only exists because a human
 * reading it infers columns from alignment. This module makes that inference
 * explicit and deterministic, so the same file always yields the same grid and
 * a figure taken from it carries the same lineage guarantee as one taken from a
 * worksheet.
 *
 * Nothing here interprets a number. It produces text in cells; the approved
 * contract decides what any of it means, exactly as it does for a spreadsheet.
 *
 * See `specs/018-governed-channel-intelligence.md` section 7.3 and ADR 0028.
 */

/** One run of text and where it was painted. `x` is its left edge. */
export type PositionedTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
};

export type PdfGridRow = {
  /** Left to right. Index 0 is the label column; the rest are value columns. */
  cells: readonly string[];
  /**
   * The label's left edge, which in a financial statement carries the outline
   * level. Kept because "Food Items" nested under "Cost of Goods Sold" means
   * something a flat list would lose.
   */
  labelIndent: number;
};

export type PdfGrid = {
  rows: readonly PdfGridRow[];
  columnCount: number;
  /** Right edges of the value columns, left to right. Diagnostic, not content. */
  valueColumnAnchors: readonly number[];
};

export type PdfGridFailure =
  /** No text layer, or nothing but whitespace. A scan lands here. */
  | "PDF_NO_TEXT_LAYER"
  /** Text exists but no column structure could be found in it. */
  | "PDF_NO_TABLE_STRUCTURE";

export type PdfGridResult =
  | { outcome: "reconstructed"; grid: PdfGrid }
  | { outcome: "failed"; code: PdfGridFailure };

/**
 * Half a line of vertical slack when deciding two fragments share a row.
 *
 * Baselines in a generated PDF are consistent but not identical — superscripts,
 * mixed font sizes, and rounding all move them a fraction of a point. Too tight
 * splits one row in two; too loose merges a row with its neighbour.
 */
const ROW_BAND = 3;

/**
 * How close two right edges must be to count as the same column.
 *
 * Numeric columns in a statement are right-aligned, so their right edges line
 * up to within a rounding error while their left edges vary by the width of the
 * number. That asymmetry is what makes the right edge the reliable anchor.
 */
const COLUMN_BAND = 6;

/** A cell whose text is a number, in the formats a statement actually uses. */
const NUMERIC = /^[([]?-?[\d,]+(\.\d+)?[)\]]?%?$/;

function isNumericText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && NUMERIC.test(trimmed) && /\d/.test(trimmed);
}

/** Fragments grouped into visual rows, top of the page first. */
function groupIntoRows(
  items: readonly PositionedTextItem[],
): { y: number; items: PositionedTextItem[] }[] {
  const populated = items
    .filter((item) => item.text.trim().length > 0)
    .sort((left, right) => right.y - left.y || left.x - right.x);

  const rows: { y: number; items: PositionedTextItem[] }[] = [];
  for (const item of populated) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= ROW_BAND);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }

  for (const row of rows) row.items.sort((left, right) => left.x - right.x);
  return rows;
}

/**
 * Where the value columns are, from the right edges of every numeric fragment.
 *
 * Derived from the numbers themselves rather than from the header. A heading
 * may be centred over its column or aligned with it depending on the generator,
 * and a statement's headings are often the same word repeated ("Total",
 * "Total", "Total"), so they identify nothing on their own. The figures always
 * align, because that is what makes the table readable in the first place.
 */
function findValueColumns(rows: readonly { items: PositionedTextItem[] }[]): number[] {
  const rightEdges: number[] = [];
  for (const row of rows) {
    for (const item of row.items) {
      if (isNumericText(item.text)) rightEdges.push(item.x + item.width);
    }
  }
  if (rightEdges.length === 0) return [];

  rightEdges.sort((left, right) => left - right);
  const clusters: { edges: number[] }[] = [];
  for (const edge of rightEdges) {
    const last = clusters[clusters.length - 1];
    if (last && edge - last.edges[last.edges.length - 1] <= COLUMN_BAND) last.edges.push(edge);
    else clusters.push({ edges: [edge] });
  }

  // A column supported by a single number is a stray figure in prose, not a
  // column. Two occurrences is the smallest thing that can establish alignment.
  return clusters
    .filter((cluster) => cluster.edges.length >= 2)
    .map((cluster) => cluster.edges.reduce((sum, edge) => sum + edge, 0) / cluster.edges.length);
}

/**
 * The document's usual line spacing, as a median.
 *
 * A median rather than a mean, because a statement's blank bands between
 * sections are large enough to drag an average well past any real line gap.
 */
function medianRowPitch(rows: readonly { y: number }[]): number | null {
  if (rows.length < 3) return null;
  const gaps: number[] = [];
  for (let index = 1; index < rows.length; index += 1) gaps.push(rows[index - 1].y - rows[index].y);
  gaps.sort((left, right) => left - right);
  const middle = Math.floor(gaps.length / 2);
  const pitch = gaps.length % 2 === 0 ? (gaps[middle - 1] + gaps[middle]) / 2 : gaps[middle];
  return pitch > 0 ? pitch : null;
}

/**
 * How much closer than the usual pitch a line must sit to count as a wrap.
 *
 * This is the one discriminator that works. A wrapped label and a section
 * heading look identical — both are text with no figures beneath a row that had
 * them — and only the spacing separates them: a wrap is part of the same
 * visual row and sits tight against it, while a heading starts a new one at the
 * document's normal pitch. Without this, "Operating Income" gets glued onto the
 * header above it and disappears as a section.
 */
const WRAP_PITCH_RATIO = 0.7;

function assignToColumn(item: PositionedTextItem, anchors: readonly number[]): number | null {
  const right = item.x + item.width;
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  anchors.forEach((anchor, index) => {
    const distance = Math.abs(anchor - right);
    if (distance <= COLUMN_BAND && distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/**
 * Rebuild a table from positioned text.
 *
 * The shape assumed is the one financial statements actually use: a
 * left-aligned label column whose indentation carries the outline, and
 * right-aligned value columns. A row carrying only a label, directly beneath a
 * row that had values, is treated as that label wrapping onto a second line —
 * "Total for Operating" / "Income" is one row in the document and has to be one
 * row here, or its figures end up attributed to a heading that does not exist.
 */
export function reconstructPdfGrid(items: readonly PositionedTextItem[]): PdfGridResult {
  if (items.every((item) => item.text.trim().length === 0)) {
    return { outcome: "failed", code: "PDF_NO_TEXT_LAYER" };
  }

  const rows = groupIntoRows(items);
  if (rows.length === 0) return { outcome: "failed", code: "PDF_NO_TEXT_LAYER" };

  const anchors = findValueColumns(rows);
  if (anchors.length === 0) return { outcome: "failed", code: "PDF_NO_TABLE_STRUCTURE" };

  const leftmostValueEdge = Math.min(...anchors);
  const pitch = medianRowPitch(rows);
  const built: PdfGridRow[] = [];
  let previousY: number | null = null;

  for (const row of rows) {
    const cells: string[] = Array.from({ length: anchors.length }, () => "");
    const labelParts: string[] = [];
    let labelIndent = Number.POSITIVE_INFINITY;
    let anyValue = false;

    for (const item of row.items) {
      const text = item.text.trim();
      if (!text) continue;

      // Anything ending clearly left of the first value column is label,
      // whatever it looks like. A date or an account code in the label column is
      // still a label, and column membership is decided by geometry rather than
      // by guessing from content.
      //
      // The tolerance is not decoration. An anchor is the mean of its cluster,
      // so roughly half the figures in the leftmost column end a fraction to the
      // left of it. Comparing against the bare anchor swallowed those into the
      // label — "Sales 0.00" instead of "Sales" with a zero in its column — and
      // only the real statement showed it, because the synthetic fixture had
      // right edges that happened to be exact.
      const inLabelZone = item.x + item.width < leftmostValueEdge - COLUMN_BAND;
      const column = inLabelZone ? null : assignToColumn(item, anchors);

      if (column === null) {
        labelParts.push(text);
        labelIndent = Math.min(labelIndent, item.x);
        continue;
      }
      cells[column] = cells[column] ? `${cells[column]} ${text}` : text;
      anyValue = true;
    }

    const label = labelParts.join(" ").replace(/\s+/g, " ").trim();
    const previous = built[built.length - 1];

    const gap = previousY === null ? null : previousY - row.y;
    const sitsTight = pitch !== null && gap !== null && gap < pitch * WRAP_PITCH_RATIO;

    if (
      !anyValue &&
      label &&
      previous &&
      sitsTight &&
      previous.cells.slice(1).some((cell) => cell !== "")
    ) {
      // A label with no figures, sitting tight under a row that had them: the
      // heading wrapped onto a second line and is part of that row.
      built[built.length - 1] = {
        ...previous,
        cells: [`${previous.cells[0]} ${label}`.trim(), ...previous.cells.slice(1)],
      };
      previousY = row.y;
      continue;
    }

    previousY = row.y;
    if (!label && !anyValue) continue;

    built.push({
      cells: [label, ...cells],
      labelIndent: Number.isFinite(labelIndent) ? labelIndent : 0,
    });
  }

  if (built.length === 0) return { outcome: "failed", code: "PDF_NO_TABLE_STRUCTURE" };

  return {
    outcome: "reconstructed",
    grid: {
      rows: built,
      columnCount: anchors.length + 1,
      valueColumnAnchors: anchors,
    },
  };
}
