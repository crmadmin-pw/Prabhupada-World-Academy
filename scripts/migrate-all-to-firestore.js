const Database = require('better-sqlite3');
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

// 1. Load env variables from .env to capture FIRESTORE_EMULATOR_HOST
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) return;
    const parts = trimmedLine.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      let value = parts.slice(1).join('=').trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  });
}

console.log("Connecting to Firestore Host:", process.env.FIRESTORE_EMULATOR_HOST || 'Production');

// 2. Initialize Firebase Admin
const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error("Error: service-account.json not found in root.");
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);
initializeApp({
  credential: cert(serviceAccount)
});

const firestore = getFirestore();
firestore.settings({ ignoreUndefinedProperties: true });

// 3. Open SQLite Database
const dbPath = path.resolve(process.cwd(), 'sadhana.db');
if (!fs.existsSync(dbPath)) {
  console.error(`Error: sadhana.db not found at ${dbPath}`);
  process.exit(1);
}
const sqliteDb = new Database(dbPath);

const tables = [
  'AshrayChecklist',
  'AshrayLevels',
  'AshrayUpgradeRequests',
  'AttendanceEvents',
  'AttendanceParticipants',
  'AttendanceRecords',
  'AttendanceSessions',
  'AttendanceVolunteers',
  'BvAttendance',
  'BvGroupMembers',
  'BvGroupRequests',
  'BvGroups',
  'BvQuizSubmissions',
  'BvQuizzes',
  'BvSessions',
  'BvslPreachingEntries',
  'BvslWeeklyPlans',
  'ChallengeEnrollments',
  'CleanlinessInspections',
  'CleanlinessReviewRequests',
  'CleanlinessRooms',
  'Config',
  'FolkResidencies',
  'GuideTransferRequests',
  'Guides',
  'JigyasaProcessedFiles',
  'JigyasaRegistrations',
  'JigyasaSessionAttendance',
  'OneToOneMeetings',
  'PreachingReportGoals',
  'PushSubscriptions',
  'RentPayments',
  'ResidencyTransferRequests',
  'SadhanaEntries',
  'SadhanaFields',
  'SadhanaMonthlySummaries',
  'ServiceAllocations',
  'ServiceAvailability',
  'ServicePreferences',
  'ServiceRatings',
  'ServiceSwaps',
  'Services',
  'SkillCatalog',
  'TagMangoSyncLog',
  'Trips',
  'UnavailabilityRequests',
  'UserSkills',
  'Users'
];

const tableColumnTypes = {};
function loadSchemaTypes() {
  const schemaPath = path.resolve(process.cwd(), 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    const tableRegex = /CREATE TABLE IF NOT EXISTS "([^"]+)" \(([\s\S]+?)\);/g;
    let match;
    while ((match = tableRegex.exec(sql)) !== null) {
      const tableName = match[1];
      const colDefs = match[2];
      tableColumnTypes[tableName] = {};
      const colRegex = /"([^"]+)"\s+(\w+)/g;
      let colMatch;
      while ((colMatch = colRegex.exec(colDefs)) !== null) {
        tableColumnTypes[tableName][colMatch[1]] = colMatch[2];
      }
    }
  }
}

function deserializeRow(tableName, row) {
  if (!row) return row;
  const types = tableColumnTypes[tableName] || {};
  const newRow = { ...row };
  for (const col of Object.keys(newRow)) {
    const val = newRow[col];
    const type = types[col];
    if (val === null || val === undefined) {
      delete newRow[col];
      continue;
    }
    if (type === 'BOOLEAN') {
      newRow[col] = val === 1 || val === '1' || val === true || val === 'true';
    } else if (type === 'NUMERIC') {
      newRow[col] = Number(val);
    } else if (typeof val === 'string') {
      if ((val.startsWith('[') && val.endsWith(']')) || (val.startsWith('{') && val.endsWith('}'))) {
        try {
          newRow[col] = JSON.parse(val);
        } catch {
          // Keep as string
        }
      }
    }
  }
  return newRow;
}

async function wipeCollection(collectionName) {
  const collectionRef = firestore.collection(collectionName);
  const snapshot = await collectionRef.limit(500).get();
  if (snapshot.size === 0) return;
  const batch = firestore.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  await wipeCollection(collectionName);
}

async function runMigration() {
  loadSchemaTypes();
  console.log("Wiping and migrating ALL records from SQLite to Firestore (including test/dummy records)...\n");

  for (const table of tables) {
    try {
      const checkTable = sqliteDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
      if (!checkTable) continue;

      const rows = sqliteDb.prepare(`SELECT * FROM "${table}"`).all();
      
      console.log(`Wiping collection "${table}"...`);
      await wipeCollection(table);

      if (rows.length === 0) {
        console.log(`No records to migrate for table "${table}".`);
        continue;
      }

      console.log(`Migrating ${rows.length} rows for table "${table}"...`);

      const batchSize = 500;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = firestore.batch();
        const chunk = rows.slice(i, i + batchSize);

        for (const row of chunk) {
          const cleanRow = deserializeRow(table, row);
          const docId = cleanRow.id || `rec_${Math.random().toString(36).substring(2, 15)}`;
          cleanRow.id = docId;

          const docRef = firestore.collection(table).doc(docId);
          batch.set(docRef, cleanRow);
        }

        await batch.commit();
      }
      console.log(`✓ Completed table "${table}"`);
    } catch (err) {
      console.error(`✗ Error migrating table "${table}":`, err.message);
    }
  }
  console.log("\nFull SQLite database successfully migrated to Firestore Emulator!");
}

runMigration().catch(console.error);
