import fs from 'fs';
import path from 'path';

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

function toFirestoreFields(obj: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!k || k === '_rawCsv') continue;
    if (v === null || v === undefined || v === '') {
      fields[k] = { nullValue: null };
    } else if (typeof v === 'boolean') {
      fields[k] = { booleanValue: v };
    } else if (typeof v === 'number') {
      if (Number.isInteger(v)) {
        fields[k] = { integerValue: String(v) };
      } else {
        fields[k] = { doubleValue: v };
      }
    } else {
      fields[k] = { stringValue: String(v) };
    }
  }
  return fields;
}

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

async function uploadCollection(collectionName: string, rows: Record<string, string>[], accessToken: string) {
  let count = 0;
  console.log(`⏳ Uploading ${rows.length} documents to Cloud Firestore collection '${collectionName}'...`);

  // Parallel batches of 15 requests
  const concurrency = 15;
  for (let i = 0; i < rows.length; i += concurrency) {
    const chunk = rows.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (rawRow, index) => {
        const docData: Record<string, any> = {};
        for (const [header, val] of Object.entries(rawRow)) {
          if (!header) continue;
          const key = toCamelCase(header);
          let value: any = val;
          if (val === 'true') value = true;
          else if (val === 'false') value = false;
          else if (val.trim() === '') value = null;
          docData[key] = value;
        }

        const rawDocId = rawRow['ID'] || rawRow['User ID'] || rawRow['Email'] || docData.id || docData.userId || `doc_${i + index + 1}`;
        // Clean docId for Firestore URL
        const safeDocId = encodeURIComponent(String(rawDocId).trim().replace(/\//g, '_'));

        const url = `https://firestore.googleapis.com/v1/projects/bvpw108/databases/(default)/documents/${collectionName}/${safeDocId}`;
        const payload = { fields: toFirestoreFields(docData) };

        try {
          const res = await fetch(url, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(payload),
          });
          if (res.ok) {
            count++;
          } else {
            const errText = await res.text();
            console.warn(`  ⚠️ Write warning for ${collectionName}/${safeDocId}: ${res.status} ${errText.slice(0, 100)}`);
          }
        } catch (e: any) {
          console.warn(`  ⚠️ Network warning for ${collectionName}/${safeDocId}:`, e?.message || e);
        }
      })
    );
  }

  console.log(`  ✅ Successfully uploaded ${count}/${rows.length} documents to '${collectionName}'`);
  return count;
}

async function main() {
  console.log('🚀 Starting direct CSV upload to Cloud Firestore (bvpw108)...');

  const configPath = '/home/vedanarayana_das/.config/configstore/firebase-tools.json';
  if (!fs.existsSync(configPath)) {
    console.error('❌ Firebase credentials file not found at:', configPath);
    process.exit(1);
  }

  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const accessToken = cfg?.tokens?.access_token;
  if (!accessToken) {
    console.error('❌ Access token missing from firebase-tools.json');
    process.exit(1);
  }

  const backupDir = path.resolve(process.cwd(), 'docs/zite-backups');
  const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.csv') && !f.includes(':Zone.Identifier'));
  console.log(`📂 Found ${files.length} CSV files to upload to Cloud Firestore bvpw108.\n`);

  let totalUploaded = 0;
  for (const filename of files) {
    const baseName = filename.split(' - Grid view')[0].trim();
    const collectionName = CSV_COLLECTION_MAP[baseName] || baseName.replace(/[^a-zA-Z0-9]/g, '');
    const filePath = path.join(backupDir, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    const rawRows = parseCSV(content);

    if (rawRows.length === 0) continue;

    const uploaded = await uploadCollection(collectionName, rawRows, accessToken);
    totalUploaded += uploaded;
  }

  console.log(`\n🎉 Cloud Firestore CSV Upload Complete! Total ${totalUploaded} documents written to project bvpw108.`);
}

main().catch(err => {
  console.error('Fatal error during Cloud Firestore upload:', err);
  process.exit(1);
});
