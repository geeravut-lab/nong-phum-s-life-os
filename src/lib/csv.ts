/**
 * Exporting what is on screen, as a file a spreadsheet will open.
 *
 * Three pages offer this and each exports what its own filters are showing, so
 * the file matches the list the person was looking at rather than everything
 * the account holds.
 *
 * The quoting rules are the ones that bite in practice:
 *   - a value containing a comma, a quote or a newline is quoted, with inner
 *     quotes doubled
 *   - a UTF-8 BOM leads the file, because Excel on Windows reads a CSV without
 *     one as the system codepage and turns every Thai character into mojibake
 *   - CRLF line endings, for the same reason
 *   - a value starting with = + - or @ is prefixed with a single quote: Excel
 *     would otherwise treat it as a formula, and a shop called "=SUM" or a
 *     note beginning with a minus sign should not execute anything
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))];
  // Written as an escape rather than the character itself, so it survives an
  // editor or a linter that treats a stray BOM as a mistake.
  const BOM = "\uFEFF";
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** Hands the browser a file to save. Returns the file name used. */
export function downloadCsv(baseName: string, headers: string[], rows: Array<Array<unknown>>) {
  const csv = toCsv(headers, rows);
  const name = `${baseName}-${new Date().toISOString().slice(0, 10)}.csv`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}
