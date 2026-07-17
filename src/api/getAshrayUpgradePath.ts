import { z } from 'zod';
import { createEndpoint, AshrayLevels } from 'zite-integrations-backend-sdk';

const LEVEL_ORDER = ['Jigyasa', 'Shraddhavan', 'Sevak', 'Sadhaka', 'Upasaka', 'Caranashraya', 'Harinam Diksha'];

const PRACTICE_GROUPS = [
  {
    category: 'Chanting',
    practices: [
      { fieldKey: 'chanting_rounds', label: 'Chanting Rounds', get: (r: any) => r.chantingRoundsRequired ? `${r.chantingRoundsRequired} rounds${r.chantingMonths ? ` for ${r.chantingMonths} months` : ''}` : '-' },
    ],
  },
  {
    category: 'Reading & Study',
    practices: [
      { fieldKey: 'sp_reading', label: 'Srila Prabhupada Reading', get: (r: any) => r.spReadingPagesPerMonth ? `${r.spReadingPagesPerMonth} pages/month` : '-' },
      { fieldKey: 'books_to_read', label: 'Books to Read', get: (r: any) => r.booksToRead || '-' },
      { fieldKey: 'course_syllabus', label: 'Course Syllabus', get: (r: any) => r.courseSyllabus || '-' },
    ],
  },
  {
    category: 'Morning Program',
    practices: [
      { fieldKey: 'morning_program', label: 'Morning Program', get: (r: any) => r.morningProgram || '-' },
      { fieldKey: 'class_frequency', label: 'Class Frequency', get: (r: any) => r.classFreqPerMonth ? `${r.classFreqPerMonth} times/month` : '-' },
      { fieldKey: 'one_on_one', label: 'One-on-One Meeting', get: (r: any) => r.oneOnOnePerMonth ? `${r.oneOnOnePerMonth} times/month` : '-' },
    ],
  },
  {
    category: 'Service',
    practices: [
      { fieldKey: 'service_hours', label: 'Service Hours', get: (r: any) => r.serviceHoursMonth ? `${r.serviceHoursMonth} hours/month` : '-' },
      { fieldKey: 'accept_krishna', label: 'Accept Krishna as Supreme', get: (r: any) => r.acceptKrishnaSpg || '-' },
    ],
  },
  {
    category: 'Regulative Principles',
    practices: [
      { fieldKey: 'avoid_onion_garlic', label: 'Avoid Onion & Garlic', get: (r: any) => r.avoidOnionGarlic || '-' },
      { fieldKey: 'avoid_intoxicants', label: 'Avoid Intoxicants', get: (r: any) => r.avoidIntoxicants || '-' },
      { fieldKey: 'no_gambling', label: 'No Gambling', get: (r: any) => r.noGambling ? 'Required' : '-' },
      { fieldKey: 'no_illicit_sex', label: 'No Illicit Relationship', get: (r: any) => r.noIllicitSex ? 'Required' : '-' },
      { fieldKey: 'avoid_nonveg', label: 'Avoid Non-vegetarian Food', get: (r: any) => r.avoidNonveg ? 'Required' : '-' },
    ],
  },
  {
    category: 'Other Requirements',
    practices: [
      { fieldKey: 'fasting', label: 'Fasting', get: (r: any) => r.fasting || '-' },
      { fieldKey: 'kanthi_mala', label: 'Kanthi Mala', get: (r: any) => r.kanthiMala ? 'Required' : '-' },
      { fieldKey: 'sadhana_score', label: 'Sadhana Score', get: (r: any) => r.sadhanaScoreRequired ? `${r.sadhanaScoreRequired}${r.sadhanaScoreMonths ? ` for ${r.sadhanaScoreMonths} months` : ''}` : '-' },
      { fieldKey: 'donation', label: 'Donation', get: (r: any) => r.donationRequired || '-' },
    ],
  },
];

export default createEndpoint({
  description: 'Get the Ashraya upgrade path with requirements per level',
  authenticated: true,
  inputSchema: z.object({ userId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async () => {
    const { records: levels } = await AshrayLevels.findAll({ limit: 20 });

    // Build a map from levelName -> record
    const levelMap: Record<string, any> = {};
    levels.forEach(r => { if (r.levelName) levelMap[r.levelName] = r; });

    const practiceGroups = PRACTICE_GROUPS.map(group => ({
      category: group.category,
      practices: group.practices.map(p => ({
        fieldKey: p.fieldKey,
        fieldLabel: p.label,
        requirements: Object.fromEntries(
          LEVEL_ORDER.map(level => [level, levelMap[level] ? p.get(levelMap[level]) : '-'])
        ),
      })),
    }));

    return { practiceGroups };
  },
});
