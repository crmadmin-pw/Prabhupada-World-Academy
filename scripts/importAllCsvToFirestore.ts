import fs from 'fs';
import path from 'path';
import { initializeApp, cert, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Helper to parse standard CSV with quoted fields
function parseCSV(text: string): Record<string, string>[] {
  const lines: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      cur += c;
    } else if (c === '\n' && !inQuotes) {
      lines.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.trim()) lines.push(cur);
  if (lines.length < 2) return [];

  function splitLine(line: string): string[] {
    const fields: string[] = [];
    let field = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (q && line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          q = !q;
        }
      } else if (char === ',' && !q) {
        fields.push(field.trim());
        field = '';
      } else {
        field += char;
      }
    }
    fields.push(field.trim());
    return fields;
  }

  const headers = splitLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = vals[idx] !== undefined ? vals[idx] : '';
    });
    return row;
  });
}

// Convert CSV header name to camelCase object field key
function toCamelCase(header: string): string {
  return header
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      if (index === 0) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join('');
}

// Map CSV filename to Firestore collection name
const CSV_COLLECTION_MAP: Record<string, string> = {
  'Users': 'Users',
  'Guides': 'Guides',
  'Folk Residencies': 'FolkResidencies',
  'Cleanliness Inspections': 'CleanlinessInspections',
  'Cleanliness Rooms': 'CleanlinessRooms',
  'Services': 'Services',
  'Service Allocations': 'ServiceAllocations',
  'Service Availability': 'ServiceAvailability',
  'Service Swaps': 'ServiceSwaps',
  'ServicePreferences': 'ServicePreferences',
  'ServiceRatings': 'ServiceRatings',
  'BV Groups': 'BvGroups',
  'BV Group Members': 'BvGroupMembers',
  'BV Group Requests': 'BvGroupRequests',
  'BV Sessions': 'BvSessions',
  'BV Attendance': 'BvAttendance',
  'BVSL Preaching Entries': 'BvslPreachingEntries',
  'BVSL Weekly Plans': 'BvslWeeklyPlans',
  'BvQuizzes': 'BvQuizzes',
  'BvQuizSubmissions': 'BvQuizSubmissions',
  'AshrayLevels': 'AshrayLevels',
  'Ashray Checklist': 'AshrayChecklist',
  'AshrayUpgradeRequests': 'AshrayUpgradeRequests',
  'Config': 'Config',
  'Jigyasa Registrations': 'JigyasaRegistrations',
  'Jigyasa Session Attendance': 'JigyasaSessionAttendance',
  'Jigyasa Processed Files': 'JigyasaProcessedFiles',
  'Sadhana Entries': 'SadhanaEntries',
  'Sadhana Fields': 'SadhanaFields',
  'Sadhana Monthly Summaries': 'SadhanaMonthlySummaries',
  'One To One Meetings': 'OneToOneMeetings',
  'Preaching Report Goals': 'PreachingReportGoals',
  'Rent Payments': 'RentPayments',
  'Trips': 'Trips',
  'Unavailability Requests': 'UnavailabilityRequests',
  'TagMango Sync Log': 'TagMangoSyncLog',
  'Push Subscriptions': 'PushSubscriptions',
  'Guide Transfer Requests': 'GuideTransferRequests',
  'Residency Transfer Requests': 'ResidencyTransferRequests',
};

async function main() {
  console.log('🚀 Initializing CSV Import to Firestore...');

  // Initialize Firestore with Application Default Credentials or Project ID
  if (getApps().length === 0) {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'bvpw108';
    const saPath = path.resolve(process.cwd(), 'service-account.json');
    let initialized = false;

    if (fs.existsSync(saPath)) {
      try {
        const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
        if (sa.private_key && sa.private_key.includes('BEGIN') && !sa.private_key.includes('dummy')) {
          initializeApp({ credential: cert(sa), projectId: sa.project_id || projectId });
          initialized = true;
        }
      } catch {}
    }

    if (!initialized) {
      try {
        initializeApp({ credential: applicationDefault(), projectId });
      } catch {
        initializeApp({ projectId });
      }
    }
  }

  const db = getFirestore();
  const backupDir = path.resolve(process.cwd(), 'docs/zite-backups');
  if (!fs.existsSync(backupDir)) {
    console.error('❌ Backup directory not found at:', backupDir);
    process.exit(1);
  }

  const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.csv') && !f.includes(':Zone.Identifier'));
  console.log(`📂 Found ${files.length} CSV files to process.\n`);

  for (const filename of files) {
    const baseName = filename.split(' - Grid view')[0].trim();
    const collectionName = CSV_COLLECTION_MAP[baseName] || baseName.replace(/[^a-zA-Z0-9]/g, '');
    const filePath = path.join(backupDir, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    const rawRows = parseCSV(content);

    if (rawRows.length === 0) {
      console.log(`⚠️ Skipping empty CSV: ${baseName}`);
      continue;
    }

    console.log(`⏳ Importing ${rawRows.length} records into collection '${collectionName}'...`);

    let importedCount = 0;
    const batchSize = 400; // Firestore max batch is 500
    let batch = db.batch();
    let batchCount = 0;

    for (const rawRow of rawRows) {
      const docData: Record<string, any> = {};
      
      // Format keys to camelCase and parse booleans/numbers
      for (const [header, val] of Object.entries(rawRow)) {
        if (!header || val === undefined) continue;
        const key = toCamelCase(header);
        
        let value: any = val;
        if (val === 'true') value = true;
        else if (val === 'false') value = false;
        else if (val.trim() === '') value = null;

        docData[key] = value;
      }

      // Preserve raw fields as well
      docData._rawCsv = rawRow;
      docData.createdAt = docData.createdAt || new Date().toISOString();

      // Determine document ID (use CSV ID, User ID, Email, or auto-generate)
      const docId = rawRow['ID'] || rawRow['User ID'] || rawRow['Email'] || docData.id || docData.userId;
      
      const docRef = docId 
        ? db.collection(collectionName).doc(docId) 
        : db.collection(collectionName).doc();

      batch.set(docRef, docData, { merge: true });
      batchCount++;
      importedCount++;

      if (batchCount >= batchSize) {
        try {
          await batch.commit();
        } catch (e: any) {
          console.warn(`  ⚠️ Batch commit warning for ${collectionName}:`, e?.message || e);
        }
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      try {
        await batch.commit();
      } catch (e: any) {
        console.warn(`  ⚠️ Batch commit warning for ${collectionName}:`, e?.message || e);
      }
    }

    console.log(`  ✅ Successfully imported ${importedCount} records to '${collectionName}'`);
  }

  console.log('\n🎉 CSV Migration completed successfully!');
}

main().catch(err => {
  console.error('Fatal error during CSV import:', err);
  process.exit(1);
});
