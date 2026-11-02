import { daysAgo, getTodayIST } from './streakUtils';

/** Members have the whole day in India to submit that day's Sadhana. */
export function completedSadhanaEndDate(endDate: string, todayIST = getTodayIST()): string {
  const yesterday = daysAgo(todayIST, 1);
  return endDate < yesterday ? endDate : yesterday;
}
