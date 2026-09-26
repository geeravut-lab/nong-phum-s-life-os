/**
 * Path normalisation for usage counting.
 *
 * The question the dashboard answers is "which menu, how many times" - so a
 * page with a parameter has to collapse to one path, or /legacy/invite/<token>
 * becomes a new row per link and the top-menus list is all noise.
 */
export function normalizeUsagePath(pathname: string): string {
  const parts = (pathname.split("?")[0] ?? "")
    .split("/")
    .filter(Boolean)
    .map((seg) =>
      // A uuid, a share token, or a bare number is an id, not a menu.
      /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || /^\d+$/.test(seg) || seg.length > 24 ? ":id" : seg,
    );
  return ("/" + parts.join("/")).slice(0, 80);
}
