import type { PositionedTextItem } from "@/domain/reports/pdf-grid";
import { REPORT_PACKAGE_LIMITS } from "@/domain/reports/types";

/**
 * Reading the text layer out of a machine-generated PDF.
 *
 * This is the only place pdf.js is touched. It extracts text runs and where
 * they were painted, and does nothing else: no rendering, no fonts fetched from
 * anywhere, no scripts run, no images looked at, and no interpretation of what
 * any run means. The grid is rebuilt from these coordinates by
 * `@/domain/reports/pdf-grid`, which is pure and testable without a PDF.
 *
 * See `specs/018-governed-channel-intelligence.md` section 7.3 and ADR 0028.
 */

/** A page ceiling, so a thousand-page document fails rather than hangs. */
export const MAX_PDF_PAGES = 200;

export type PdfPage = {
  pageNumber: number;
  items: PositionedTextItem[];
};

export type PdfTextLayerResult =
  | { outcome: "extracted"; pages: PdfPage[] }
  | { outcome: "failed"; code: "UNREADABLE_WORKBOOK" | "TOO_MANY_PAGES" | "PDF_NO_TEXT_LAYER" };

type PdfTextRun = { str: string; width: number; transform: number[] };

export async function extractPdfTextLayer(buffer: Buffer): Promise<PdfTextLayerResult> {
  // Imported lazily so the Next.js request path never pulls pdf.js into a
  // bundle it has no use for. Only the worker reads PDFs.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // The loading task owns the worker and the buffer; the document proxy does
  // not. Destroying the task is what actually releases them.
  let loadingTask;
  let document;
  try {
    loadingTask = getDocument({
      data: new Uint8Array(buffer),
      // Untrusted input. Nothing in the file may execute, fetch, or be trusted
      // to describe itself: no XFA or AcroForm scripting, and no font or
      // resource fetched from the network. pdf.js 6 dropped `isEvalSupported`
      // because it no longer evaluates font programs at all, so that hardening
      // is now the default rather than a flag.
      useSystemFonts: false,
      disableFontFace: true,
      enableXfa: false,
      stopAtErrors: true,
    });
    document = await loadingTask.promise;
  } catch {
    return { outcome: "failed", code: "UNREADABLE_WORKBOOK" };
  }

  try {
    if (document.numPages > MAX_PDF_PAGES) return { outcome: "failed", code: "TOO_MANY_PAGES" };

    const pages: PdfPage[] = [];
    let runCount = 0;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: PositionedTextItem[] = [];

      for (const run of content.items as PdfTextRun[]) {
        if (typeof run.str !== "string" || run.str.trim().length === 0) continue;
        runCount += 1;
        // A text run is not a cell, but it is the closest thing this format has,
        // so the same ceiling that bounds a worksheet bounds this too.
        if (runCount > REPORT_PACKAGE_LIMITS.maxPopulatedCells) {
          return { outcome: "failed", code: "UNREADABLE_WORKBOOK" };
        }
        items.push({
          text: run.str,
          x: run.transform[4],
          y: run.transform[5],
          width: run.width ?? 0,
        });
      }

      pages.push({ pageNumber, items });
      page.cleanup();
    }

    // Every page rendered and not one carried a text run: a scan, or an
    // image-only export. There is nothing here to read and nothing to guess.
    if (pages.every((page) => page.items.length === 0)) {
      return { outcome: "failed", code: "PDF_NO_TEXT_LAYER" };
    }

    return { outcome: "extracted", pages };
  } catch {
    return { outcome: "failed", code: "UNREADABLE_WORKBOOK" };
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

/** The OLE compound-document signature that opens every pre-2007 `.xls`. */
const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * Whether a buffer is a legacy binary `.xls` rather than a real `.xlsx`.
 *
 * Worth detecting by content rather than by extension: the pilot client's
 * provider serves a BIFF file, and a file renamed to `.xlsx` would otherwise
 * reach ExcelJS and fail with an unreadable-archive error that tells the
 * operator nothing they can act on.
 */
export function isLegacyXlsBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, OLE_SIGNATURE.length).equals(OLE_SIGNATURE);
}
