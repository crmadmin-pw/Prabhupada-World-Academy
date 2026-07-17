import { z } from 'zod';
import { createEndpoint, JigyasaRegistrations, JigyasaProcessedFiles, JigyasaSessionAttendance } from 'zite-integrations-backend-sdk';
import { mangoToCentre } from '../lib/mangoToCentre';

export default createEndpoint({
  description: 'Get Jigyasa attendance tracker data with filters',
  authenticated: true,
  inputSchema: z.object({
    centre: z.string().optional(),
    affiliate: z.string().optional(),
    search: z.string().optional(),
    offset: z.number().optional(),
    limit: z.number().optional(),
    tab: z.enum(['summary', 'sessions', 'files']).optional(),
  }),
  outputSchema: z.object({
    registrations: z.array(z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      phone: z.string(),
      state: z.string(),
      mangoName: z.string(),
      centreName: z.string(),
      affiliateName: z.string(),
      affiliateEmail: z.string(),
      age: z.string(),
      gender: z.string(),
      city: z.string(),
      occupation: z.string(),
      attendanceMode: z.string(),
      totalSessions: z.number(),
      totalDuration: z.string(),
    })),
    sessionRecords: z.array(z.object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
      mangoName: z.string(),
      centreName: z.string(),
      affiliateName: z.string(),
      sessionDate: z.string(),
      durationDisplay: z.string(),
    })),
    processedFiles: z.array(z.object({
      id: z.string(),
      fileName: z.string(),
      fileType: z.string(),
      sessionDate: z.string(),
      recordsProcessed: z.number(),
      processedAt: z.string(),
    })),
    stats: z.object({
      totalRegistered: z.number(),
      attendedAtLeastOne: z.number(),
      totalSessionDates: z.number(),
      centres: z.array(z.string()),
      affiliates: z.array(z.string()),
    }),
    hasMore: z.boolean(),
    totalCount: z.number(),
  }),
  execute: async ({ input }) => {
    const tab = input.tab || 'summary';
    const limit = Math.min(input.limit || 50, 200);
    const offset = input.offset || 0;

    // For filter options, get ALL registrations (unfiltered)
    const { records: allRegsUnfiltered } = await JigyasaRegistrations.findAll({
      limit: 2000,
      fields: ['mangoName', 'affiliateName', 'totalSessions'],
    });

    const centreSet = new Set<string>();
    const affiliateSet = new Set<string>();
    for (const r of allRegsUnfiltered) {
      const cn = mangoToCentre(r.mangoName);
      if (cn) centreSet.add(cn);
      if (r.affiliateName) affiliateSet.add(r.affiliateName);
    }

    // Build registration filters (filter on raw mangoName values that map to selected centre)
    const filters: any = {};
    if (input.affiliate) filters.affiliateName = input.affiliate;
    if (input.search) filters.name = { contains: input.search };
    // Centre filter: find all mangoName values that map to the selected centre
    if (input.centre) {
      const matchingMangos = [...new Set(allRegsUnfiltered
        .filter(r => mangoToCentre(r.mangoName) === input.centre)
        .map(r => r.mangoName)
        .filter(Boolean))] as string[];
      if (matchingMangos.length === 1) {
        filters.mangoName = matchingMangos[0];
      } else if (matchingMangos.length > 1) {
        filters.mangoName = { in: matchingMangos };
      } else {
        // No match — force empty results
        filters.mangoName = '__NO_MATCH__';
      }
    }

    // Get filtered registrations for stats
    const { records: allRegs } = await JigyasaRegistrations.findAll({
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      limit: 2000,
      fields: ['mangoName', 'affiliateName', 'totalSessions'],
    });

    let attendedAtLeastOne = 0;
    for (const r of allRegs) {
      if ((r.totalSessions || 0) > 0) attendedAtLeastOne++;
    }

    // Get unique session dates count
    const { records: allSessions } = await JigyasaSessionAttendance.findAll({
      limit: 2000,
      fields: ['sessionDate'],
    });
    const sessionDateSet = new Set(allSessions.map(s => s.sessionDate).filter(Boolean));

    const stats = {
      totalRegistered: allRegs.length,
      attendedAtLeastOne,
      totalSessionDates: sessionDateSet.size,
      centres: [...centreSet].sort(),
      affiliates: [...affiliateSet].sort(),
    };

    let registrations: any[] = [];
    let sessionRecords: any[] = [];
    let processedFiles: any[] = [];
    let hasMore = false;
    let totalCount = allRegs.length;

    if (tab === 'summary') {
      const { records, hasMore: hm } = await JigyasaRegistrations.findAll({
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        offset,
        limit,
      });
      hasMore = hm;
      registrations = records.map(r => ({
        id: r.id,
        name: r.name || '',
        email: r.email || '',
        phone: r.phone || '',
        state: r.state || '',
        mangoName: r.mangoName || '',
        centreName: mangoToCentre(r.mangoName),
        affiliateName: r.affiliateName || '',
        affiliateEmail: r.affiliateEmail || '',
        age: r.age || '',
        gender: r.gender || '',
        city: r.city || '',
        occupation: r.occupation || '',
        attendanceMode: r.attendanceMode || '',
        totalSessions: r.totalSessions || 0,
        totalDuration: r.totalDuration || '00:00:00',
      }));
    } else if (tab === 'sessions') {
      // Read directly from registrations (precomputed sessionMatrix) — no N+1 joins needed
      const { records: regsWithMatrix, hasMore: hm } = await JigyasaRegistrations.findAll({
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        offset,
        limit: 2000,
        fields: ['name', 'email', 'mangoName', 'affiliateName', 'sessionMatrix'],
      });
      hasMore = hm;

      // Flatten into sessionRecords for the pivot builder on the frontend
      for (const reg of regsWithMatrix) {
        if (!reg.sessionMatrix) continue;
        let matrix: Record<string, number> = {};
        try { matrix = JSON.parse(reg.sessionMatrix); } catch { continue; }
        const centreName = mangoToCentre(reg.mangoName);
        for (const [date, mins] of Object.entries(matrix)) {
          const h = Math.floor(mins / 60);
          const m = mins % 60;
          sessionRecords.push({
            id: `${reg.id}_${date}`,
            email: reg.email || '',
            name: reg.name || '',
            mangoName: reg.mangoName || '',
            centreName,
            affiliateName: reg.affiliateName || '',
            sessionDate: date,
            durationDisplay: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`,
          });
        }
      }
      totalCount = regsWithMatrix.length;
    } else if (tab === 'files') {
      const { records: files } = await JigyasaProcessedFiles.findAll({ limit: 200 });
      processedFiles = files.map(f => ({
        id: f.id,
        fileName: f.fileName || '',
        fileType: f.fileType || '',
        sessionDate: f.sessionDate || '',
        recordsProcessed: f.recordsProcessed || 0,
        processedAt: f.processedAt || '',
      }));
      totalCount = files.length;
    }

    return { registrations, sessionRecords, processedFiles, stats, hasMore, totalCount };
  },
});
