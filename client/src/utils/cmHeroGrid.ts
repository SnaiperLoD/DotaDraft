export type HeroGridDir = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';

/** Valve pick screen: two portraits wide, row-major within an attribute. */
export function valvePickColumns(heroIds: number[]): number[][] {
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < heroIds.length; i++) {
    (i % 2 === 0 ? left : right).push(heroIds[i]);
  }
  return [left, right];
}

export function firstEnabledHero(columns: number[][], enabled: ReadonlySet<number>): number | null {
  for (const col of columns) {
    for (const id of col) {
      if (enabled.has(id)) return id;
    }
  }
  return null;
}

function locate(columns: number[][], id: number): { col: number; row: number } | null {
  for (let col = 0; col < columns.length; col++) {
    const row = columns[col].indexOf(id);
    if (row >= 0) return { col, row };
  }
  return null;
}

/** Roving cursor for the Valve 8-column CM grid (2 per attribute). Skips disabled ids, wraps. */
export function moveHeroCursor(
  columns: number[][],
  enabled: ReadonlySet<number>,
  fromId: number | null,
  dir: HeroGridDir,
): number | null {
  const fallback = firstEnabledHero(columns, enabled);
  if (fallback == null) return null;
  const start = fromId != null ? locate(columns, fromId) : null;
  if (!start) return fallback;

  if (dir === 'home') {
    const col = columns[start.col];
    return col.find((id) => enabled.has(id)) ?? fallback;
  }
  if (dir === 'end') {
    const col = columns[start.col];
    for (let i = col.length - 1; i >= 0; i--) {
      if (enabled.has(col[i])) return col[i];
    }
    return fallback;
  }

  let { col, row } = start;
  for (let i = 0; i < 256; i++) {
    if (dir === 'down') {
      row += 1;
      if (row >= columns[col].length) row = 0;
    } else if (dir === 'up') {
      row -= 1;
      if (row < 0) row = columns[col].length - 1;
    } else if (dir === 'right') {
      col = (col + 1) % columns.length;
      row = Math.min(row, columns[col].length - 1);
    } else {
      col = (col - 1 + columns.length) % columns.length;
      row = Math.min(row, columns[col].length - 1);
    }
    const id = columns[col][row];
    if (id === fromId) return fromId;
    if (enabled.has(id)) return id;
  }
  return fallback;
}
