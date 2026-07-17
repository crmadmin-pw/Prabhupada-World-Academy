import { addMonths, format, isAfter } from 'date-fns';

const LEVEL_ORDER = [
  'Jigyasa', 'Shraddhavan', 'Sevak', 'Sadhaka',
  'Upasaka', 'Caranashraya', 'Harinam Diksha', 'Gauranga Sabha',
];

// Minimum months at each level before next upgrade is eligible
const MONTHS_AT_LEVEL: Record<string, number> = {
  Jigyasa: 1,
  Shraddhavan: 3,
  Sevak: 3,
  Sadhaka: 6,
  Upasaka: 6,
  Caranashraya: 12,
  'Harinam Diksha': 12,
  'Gauranga Sabha': 0,
};

export function computeNextAshrayDate(
  currentLevel: string | null,
  residencyJoinDate: string | null
): { nextDate: string | null; monthsLeft: number; nextLevel: string | null } {
  if (!currentLevel || !residencyJoinDate) {
    return { nextDate: null, monthsLeft: 0, nextLevel: null };
  }

  const idx = LEVEL_ORDER.indexOf(currentLevel);
  if (idx === -1 || idx === LEVEL_ORDER.length - 1) {
    return { nextDate: null, monthsLeft: 0, nextLevel: null };
  }

  const nextLevel = LEVEL_ORDER[idx + 1];
  const monthsNeeded = MONTHS_AT_LEVEL[currentLevel] ?? 3;
  const joinDate = new Date(residencyJoinDate);
  const eligibleDate = addMonths(joinDate, monthsNeeded);
  const today = new Date();

  const monthsLeft = isAfter(eligibleDate, today)
    ? Math.ceil(
        (eligibleDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30)
      )
    : 0;

  return {
    nextDate: format(eligibleDate, 'dd MMM yyyy'),
    monthsLeft,
    nextLevel,
  };
}
