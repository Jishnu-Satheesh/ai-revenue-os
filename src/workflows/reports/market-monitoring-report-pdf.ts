import "server-only";

import {
  reportDownloadFilename,
  type AssembledReportView,
} from "@/modules/growth-intelligence/application/report-reader";

/**
 * Market Monitoring report PDF renderer (Slice 5).
 *
 * A small deterministic writer that renders the same assembled report
 * version the reader dialog shows — identity, brief scope, findings,
 * gaps, competitor comparison, the labelled estimate block, draft advice
 * and sources. It is an independent implementation from the structured
 * payload: the prototype's fixture exporter is never reused.
 *
 * Renderer choice (recorded for the brief): hand-rolled minimal PDF 1.4
 * with the two built-in Helvetica faces and no new dependency. A vendored
 * PDF library would add an unaudited binary-text dependency for a static
 * text document; the writer below is ~200 reviewable lines, emits
 * deterministic bytes (no timestamps, no ids in metadata), and keeps every
 * literal operator name byte-identical through single-byte emission with a
 * /Differences encoding plus a ToUnicode CMap when the text leaves WinAnsi.
 * Tagged-PDF accessibility is NOT established here
 * (same limit as the prototype) and is recorded as a known limitation.
 */

type BlockStyle = "title" | "heading" | "meta" | "body" | "bullet";

type Block = { style: BlockStyle; text: string };

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 50;
const TOP_Y = 775;
const BOTTOM_LIMIT = 55;
const FOOTER_Y = 30;

const STYLE_SIZE: Record<BlockStyle, number> = {
  title: 21,
  heading: 12,
  meta: 9,
  body: 10.5,
  bullet: 10.5,
};

const STYLE_WIDTH: Record<BlockStyle, number> = {
  title: 44,
  heading: 72,
  meta: 96,
  body: 90,
  bullet: 88,
};

/**
 * Single-byte text emission.
 *
 * Standard Helvetica only names WinAnsi glyphs, yet operator content keeps
 * its literal names in any script. Every Tj operand therefore travels as
 * single bytes: WinAnsi-mappable characters use their WinAnsi byte, and
 * anything else takes a free byte documented by a /Differences encoding
 * plus a ToUnicode CMap, so extraction recovers the exact code points
 * while no literal name is ever folded away. Bytes render as .notdef in
 * viewers without the glyph (Helvetica has no Arabic faces) — recorded as
 * a known limitation; the bytes and the extraction stay exact.
 */
const WINANSI_80_9F: (number | null)[] = [
  0x20ac, null, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, null, 0x017d, null,
  null, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, null, 0x017e, 0x0178,
];

function winAnsiByteFor(char: string): number | null {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  const narrow = WINANSI_80_9F.indexOf(code);
  return narrow >= 0 ? 0x80 + narrow : null;
}

function glyphNameFor(codePoint: number): string {
  const hex = codePoint.toString(16).toUpperCase();
  return codePoint <= 0xffff ? `/uni${hex.padStart(4, "0")}` : `/u${hex}`;
}

function cmapHex(codePoint: number): string {
  return codePoint <= 0xffff
    ? codePoint.toString(16).toUpperCase().padStart(4, "0")
    : (() => {
        const high = 0xd800 + ((codePoint - 0x10000) >> 10);
        const low = 0xdc00 + ((codePoint - 0x10000) & 0x3ff);
        return (
          high.toString(16).toUpperCase().padStart(4, "0") +
          low.toString(16).toUpperCase().padStart(4, "0")
        );
      })();
}

export type PdfTextEncoder = {
  /** Encode one row to a hex-string operand with the document's byte map. */
  encode: (value: string) => string;
  /** /Differences body for the font dictionaries ("" when unused). */
  differences: string;
  /** ToUnicode CMap stream for the document's exotic bytes (null when unused). */
  toUnicodeStream: string | null;
};

/** Build the document byte map over every string the PDF will paint. */
export function createPdfTextEncoder(strings: readonly string[]): PdfTextEncoder {
  const usedWinAnsi = new Set<number>();
  const exotic = new Map<string, number>();
  for (const text of strings) {
    for (const char of text) {
      const byte = winAnsiByteFor(char);
      if (byte !== null) {
        usedWinAnsi.add(byte);
        continue;
      }
      if (!exotic.has(char)) exotic.set(char, -1);
    }
  }
  const free: number[] = [];
  for (let byte = 0x80; byte <= 0xff; byte += 1) {
    if (!usedWinAnsi.has(byte)) free.push(byte);
  }
  if (free.length < exotic.size) {
    throw new Error("The report carries more distinct scripts than one PDF font map can hold.");
  }
  let index = 0;
  for (const char of exotic.keys()) exotic.set(char, free[index++]!);

  const byteFor = (char: string): number => {
    const direct = winAnsiByteFor(char);
    if (direct !== null) return direct;
    return exotic.get(char) ?? 0x3f;
  };

  let differences = "";
  if (exotic.size > 0) {
    const codes = [...exotic.values()].sort((left, right) => left - right);
    const runs: number[][] = [];
    for (const code of codes) {
      const run = runs[runs.length - 1];
      if (run && code === run[run.length - 1]! + 1) run.push(code);
      else runs.push([code]);
    }
    const codeToChar = new Map<number, string>();
    for (const [char, code] of exotic) codeToChar.set(code, char);
    differences =
      " /Differences [" +
      runs
        .map(
          (run) =>
            `${run[0]} ` +
            run.map((code) => glyphNameFor(codeToChar.get(code)!.codePointAt(0)!)).join(" "),
        )
        .join(" ") +
      "]";
  }

  let toUnicodeStream: string | null = null;
  if (exotic.size > 0) {
    const entries = [...exotic.entries()].map(
      ([char, code]) =>
        `<${code.toString(16).toUpperCase().padStart(2, "0")}> <${cmapHex(char.codePointAt(0)!)}>`,
    );
    toUnicodeStream = [
      "/CIDInit /ProcSet findresource begin",
      "12 dict begin",
      "begincmap",
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
      "/CMapName /Adobe-Identity-UCS def",
      "/CMapType 2 def",
      "1 begincodespacerange",
      "<00> <FF>",
      "endcodespacerange",
      `${entries.length} beginbfchar`,
      ...entries,
      "endbfchar",
      "endcmap",
      "CMapName currentdict /CMap defineresource pop",
      "end",
      "end",
    ].join("\n");
  }

  return {
    encode: (value: string) => {
      let hex = "";
      for (const char of value) hex += byteFor(char).toString(16).toUpperCase().padStart(2, "0");
      return `<${hex}>`;
    },
    differences,
    toUnicodeStream,
  };
}

function wrapText(text: string, width: number): string[] {
  const rows: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      rows.push("");
      continue;
    }
    let line = "";
    for (let word of words) {
      while (word.length > width) {
        if (line) {
          rows.push(line);
          line = "";
        }
        rows.push(word.slice(0, width));
        word = word.slice(width);
      }
      const next = line ? `${line} ${word}` : word;
      if (next.length > width) {
        rows.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) rows.push(line);
  }
  return rows;
}

function styleColor(style: BlockStyle): string {
  if (style === "heading") return "0.05 0.4 0.28";
  if (style === "meta") return "0.43 0.43 0.43";
  return "0.1 0.1 0.1";
}

/** The block model both the reader parity test and the writer share. */
export function reportPdfBlocks(view: AssembledReportView): Block[] {
  const brief = view.brief;
  const competitorScope =
    brief.competitors.length > 0
      ? `Competitors: ${brief.competitors.map((c) => `${c.name} (${c.sourceLabel})`).join("; ")}.`
      : "No competitors were named in the brief.";
  const blocks: Block[] = [
    { style: "title", text: view.identity.projectTitle },
    {
      style: "meta",
      text: `${view.identity.locationName} | Report ${view.identity.reportDateUtcLabel} | Brief ${view.identity.briefRevisionNumber}`,
    },
  ];
  if (view.identity.plainLanguageRequired) {
    blocks.push({ style: "meta", text: "Written in simple English." });
  }
  blocks.push(
    { style: "heading", text: "The short version" },
    { style: "body", text: view.summary },
    { style: "heading", text: "Research question" },
    { style: "body", text: brief.question },
    {
      style: "body",
      text: `${brief.researchArea} · ${brief.frequency === "once" ? "One-time research" : `Recurring research · ${brief.frequency}`}${brief.eventDate ? ` · Event date ${brief.eventDate}` : ""}`,
    },
    { style: "body", text: competitorScope },
    {
      style: "body",
      text: `Investigation areas: ${brief.investigationAreas.map((area) => area.label).join("; ")}.`,
    },
  );
  if (brief.evidencePeriods.length > 0) {
    blocks.push({
      style: "body",
      text: `Evidence periods: ${brief.evidencePeriods.map((period) => period.label).join("; ")}.`,
    });
  }
  blocks.push({ style: "heading", text: "Findings" });
  view.findings.forEach((finding, index) => {
    const refs = finding.citations.map((ref) => `[${ref}]`).join(" ");
    blocks.push({
      style: "body",
      text: `${index + 1}. ${finding.statement}${refs ? ` ${refs}` : ""}`,
    });
  });
  if (view.gaps.length > 0) {
    blocks.push({ style: "heading", text: "Where the evidence is incomplete" });
    for (const gap of view.gaps) blocks.push({ style: "body", text: gap.description });
  }
  blocks.push(
    { style: "heading", text: "Competitors and their offers" },
    { style: "body", text: "Public visibility is a signal, not proof of business performance." },
  );
  for (const entry of view.competitorComparison) {
    const refs = entry.citations.map((ref) => `[${ref}]`).join(" ");
    blocks.push({ style: "heading", text: entry.competitorName });
    blocks.push({ style: "body", text: `${entry.summary}${refs ? ` ${refs}` : ""}` });
  }
  if (view.speculativeEstimate) {
    const estimate = view.speculativeEstimate;
    blocks.push(
      { style: "heading", text: "Speculative estimate" },
      { style: "body", text: estimate.label },
      { style: "heading", text: estimate.rangeText },
      {
        style: "body",
        text: "Speculative estimate, not reported revenue. These are assumed figures, not measured competitor results, and sales before costs — never profit.",
      },
      { style: "heading", text: "Assumptions behind this range" },
      ...estimate.assumptions.map((assumption) => ({ style: "bullet" as const, text: assumption })),
      { style: "heading", text: "Reasoning" },
      { style: "body", text: estimate.reasoning },
    );
  }
  blocks.push(
    { style: "heading", text: "The local opportunity" },
    { style: "body", text: view.localMeaning },
    {
      style: "body",
      text: "Potential opportunity, not a promised result. The report proposes what to investigate; it does not claim that a campaign has earned revenue or profit.",
    },
    { style: "heading", text: "Draft advice for review" },
    {
      style: "body",
      text: "These are draft ideas. Campaign approval, budget and publishing remain separate decisions.",
    },
  );
  if (view.draftAdvice.length === 0) {
    blocks.push({ style: "body", text: "No draft advice was saved with this report." });
  }
  for (const advice of view.draftAdvice) {
    blocks.push({ style: "heading", text: advice.title });
    blocks.push({ style: "body", text: advice.detail });
    blocks.push({ style: "meta", text: `Adds to ${advice.destinationLabel} · Review required` });
  }
  blocks.push({ style: "heading", text: "Sources and evidence" });
  blocks.push({ style: "body", text: `Evidence digest: ${view.identity.evidenceDigest}` });
  for (const source of view.sources) {
    blocks.push({ style: "heading", text: `[${source.sourceRef}]` });
    if (source.available && source.url) {
      blocks.push({ style: "body", text: source.url });
    } else {
      blocks.push({
        style: "body",
        text: `Source evidence no longer available. The reference [${source.sourceRef}] is retained with the report.`,
      });
    }
    if (source.retrievedAtUtc) blocks.push({ style: "meta", text: source.retrievedAtUtc });
  }
  return blocks;
}

export type RenderedReportPdf = {
  bytes: Buffer;
  pageCount: number;
  filename: string;
};

export function renderMarketMonitoringReportPdf(view: AssembledReportView): RenderedReportPdf {
  const blocks = reportPdfBlocks(view);
  // The footer paints the title too, so it joins the scanned set — digits
  // stand in for every page number the layout may produce.
  const encoder = createPdfTextEncoder([
    ...blocks.map((block) => block.text),
    `${view.identity.projectTitle} | 0123456789`,
  ]);
  const encode = encoder.encode;
  const pages: string[] = [];
  let commands: string[] = [];
  let y = TOP_Y;

  function footer(): void {
    commands.push(
      `BT /F1 9 Tf 0.4 0.4 0.4 rg ${MARGIN_X} ${FOOTER_Y} Td ${encode(`${view.identity.projectTitle} | ${pages.length + 1}`)} Tj ET`,
    );
    pages.push(commands.join("\n"));
    commands = [];
    y = TOP_Y;
  }

  for (const block of blocks) {
    const size = STYLE_SIZE[block.style];
    const rows = wrapText(block.text, STYLE_WIDTH[block.style]);
    const needed = rows.length * (size + 5) + 14;
    if (y - needed < BOTTOM_LIMIT) footer();
    if (block.style === "heading") y -= 8;
    const color = styleColor(block.style);
    const font = block.style === "title" || block.style === "heading" ? "F2" : "F1";
    const prefix = block.style === "bullet" ? "- " : "";
    for (const row of rows) {
      if (y < BOTTOM_LIMIT) footer();
      commands.push(
        `BT /${font} ${size} Tf ${color} rg ${MARGIN_X} ${y.toFixed(1)} Td ${encode(prefix + row)} Tj ET`,
      );
      y -= size + 5;
    }
    y -= 8;
  }
  footer();

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding${encoder.differences} >>${encoder.toUnicodeStream === null ? "" : " /ToUnicode 5 0 R"} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding${encoder.differences} >>${encoder.toUnicodeStream === null ? "" : " /ToUnicode 5 0 R"} >>`,
  ];
  if (encoder.toUnicodeStream !== null) {
    objects.push(`<< /Length ${encoder.toUnicodeStream.length} >>\nstream\n${encoder.toUnicodeStream}\nendstream`);
    // The CMap lands on object 5 by construction: catalog, pages, two
    // fonts, then this stream, before any page object. One document
    // carries one byte map.
    if (objects.length !== 5) throw new Error("The report font map did not land on object 5.");
  }
  const kids: string[] = [];
  for (const stream of pages) {
    const pageId = objects.length + 1;
    const streamId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  return { bytes: Buffer.from(pdf, "latin1"), pageCount: pages.length, filename: reportDownloadFilename(view.identity.projectTitle) };
}
