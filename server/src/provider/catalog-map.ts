/** Pure mapping between database rows and the public catalog shape. This module
    deliberately imports no database client so the mapping can be unit tested
    without a Postgres instance. */

export type CatalogAgent = {
  id: string;
  slug: string;
  icon: string;
  name: string;
  division: string;
  divisionLabel: string;
  category: string;
  price: number;
  description: string;
  longDescription: string;
  features: string[];
  prompts: string[];
  welcome: string;
};

export type CatalogDivision = {
  slug: string;
  label: string;
  labelFa: string;
  icon: string;
  color: string;
  count: number;
};

export type CatalogFile = {
  agents: CatalogAgent[];
  divisions: CatalogDivision[];
};

export type DivisionRow = {
  slug: string;
  label: string;
  labelFa: string;
  icon: string;
  color: string;
  sortOrder: number;
};

/** Columns the catalog API exposes. Keeps internal bookkeeping (timestamps)
    and derived marketing fields (rating, sales) out of the response. */
export const AGENT_SELECT = {
  id: true,
  slug: true,
  icon: true,
  name: true,
  division: true,
  divisionLabel: true,
  category: true,
  price: true,
  description: true,
  longDescription: true,
  features: true,
  prompts: true,
  welcome: true,
} as const;

export function divisionCounts(
  rows: { division: string; _count: { _all: number } }[],
): Map<string, number> {
  return new Map(rows.map((row) => [row.division, row._count._all]));
}

export function toCatalogDivision(row: DivisionRow, count: number): CatalogDivision {
  return {
    slug: row.slug,
    label: row.label,
    labelFa: row.labelFa,
    icon: row.icon,
    color: row.color,
    count,
  };
}
