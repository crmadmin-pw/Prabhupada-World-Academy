/** Mango Name → FOLK Centre mapping */
const MANGO_TO_CENTRE: Record<string, string> = {
  'Purusottama': 'FOLK Powai',
  'Vasudeva': 'FOLK Vashi',
  'Shyamsundar': 'FOLK Sion',
  'Achyuta': 'FOLK Airoli',
  'Trivikrama': 'FOLK Thane',
  'PW': 'Prabhupada World',
};

/**
 * Derive the FOLK centre name from a TagMango "Mango Name" string.
 * Checks if any mapping key appears as a substring (case-insensitive).
 * Returns the mapped centre name, or the raw mangoName if no match found.
 */
export function mangoToCentre(mangoName: string | undefined | null): string {
  if (!mangoName) return '';
  for (const [key, centre] of Object.entries(MANGO_TO_CENTRE)) {
    if (mangoName.includes(key)) return centre;
  }
  return mangoName;
}
