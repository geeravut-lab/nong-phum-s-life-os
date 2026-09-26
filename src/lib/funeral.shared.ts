/**
 * Funeral planning maths, with no server or network in it so it can be tested
 * directly - the numbers here are money the user will actually transfer.
 */

/**
 * Split a total into equal monthly instalments that still add up.
 *
 * Dividing and rounding each row leaves the platform short or the user
 * overcharged by a few baht, so every row is the floor and the remainder is
 * added to the first one - the payment nobody has to be reminded about.
 */
export function installmentSchedule(
  total: number,
  months: number,
): Array<{ seq: number; dueOn: string; amount: number }> {
  const n = Math.max(1, Math.floor(months));
  if (n === 1) return [{ seq: 1, dueOn: isoDate(new Date()), amount: round2(total) }];

  const base = Math.floor((total / n) * 100) / 100;
  const rows: Array<{ seq: number; dueOn: string; amount: number }> = [];
  const start = new Date();
  for (let i = 0; i < n; i++) {
    const due = new Date(start);
    // The first instalment is due today; the rest a month apart. setMonth on
    // the 31st rolls into the next month, so anchor on the 1st-safe day.
    due.setDate(Math.min(start.getDate(), 28));
    due.setMonth(due.getMonth() + i);
    rows.push({ seq: i + 1, dueOn: isoDate(due), amount: base });
  }
  const drift = round2(total - base * n);
  rows[0]!.amount = round2(base + drift);
  return rows;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
