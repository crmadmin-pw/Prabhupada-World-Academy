interface ReportLocation {
  residencyId?: string | null;
  residencyName?: string | null;
}

const normalize = (value: unknown) => String(value || '').trim().toLowerCase();

/** Derive choices only from the report rows the server authorized. */
export function mentorReportLocation(user: ReportLocation, residencies: ReportLocation[]) {
  const reference = normalize(user.residencyId);
  const known = residencies.find(location => reference && normalize(location.residencyId) === reference);
  const name = String(user.residencyName || known?.residencyName || '').trim().replace(/^FOLK\s+/i, '');
  return { value: normalize(name) || reference, label: name || String(user.residencyId || '').trim() };
}

export function mentorReportLocations(users: ReportLocation[], residencies: ReportLocation[]) {
  const options = new Map<string, { value: string; label: string }>();
  for (const user of users) {
    const option = mentorReportLocation(user, residencies);
    if (option.value) options.set(option.value, option);
  }
  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
}
