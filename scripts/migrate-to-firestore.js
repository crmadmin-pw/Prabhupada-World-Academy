const Database = require('better-sqlite3');
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

// ══════════════════════════════════════════════════════════════════════════════
// EXCLUDED_EMAILS: Explicit list of test accounts to skip during migration.
// Add any test emails (like Sameer Khator's test account) to this array:
// ══════════════════════════════════════════════════════════════════════════════
const EXCLUDED_EMAILS = [
  // Add any test/dummy emails to exclude from migration here
];

// 1. Initialize Firebase Admin
const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error("Error: service-account.json not found in the root directory!");
  console.log("Please download your Firebase Service Account private key JSON and save it as 'service-account.json' in the project root.");
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);
initializeApp({
  credential: cert(serviceAccount)
});

const firestore = getFirestore();
firestore.settings({ ignoreUndefinedProperties: true });

// 2. Open SQLite Database
const dbPath = path.resolve(process.cwd(), 'sadhana.db');
if (!fs.existsSync(dbPath)) {
  console.error(`Error: sadhana.db not found at ${dbPath}`);
  process.exit(1);
}
const sqliteDb = new Database(dbPath);

// List of all tables to migrate
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
  'LlpAppointmentSlots',
  'LlpBookings',
  'LlpBvAttendance',
  'LlpBvGroupMembers',
  'LlpBvGroups',
  'LlpBvSessions',
  'LlpFormConfig',
  'LlpGuides',
  'LlpSadhanaEntries',
  'LlpServiceLog',
  'LlpServiceTypes',
  'LlpUsers',
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

// Helper to deserialize JSON fields before writing to Firestore
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
      delete newRow[col]; // omit nulls/undefined for Firestore
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

async function runMigration() {
  loadSchemaTypes();
  console.log("Starting migration of SQLite database to Firebase Firestore (excluding dummy/test data)...\n");

  // 1. Resolve valid users first
  const validUserIds = new Set();
  const validUserEmails = new Set();
  try {
    const userRows = sqliteDb.prepare(`SELECT * FROM "Users"`).all();
    userRows.forEach(row => {
      const email = String(row.email || '').toLowerCase();
      const fullName = String(row.fullName || '').toLowerCase();
      const id = String(row.id || '').toLowerCase();
      
      const isExcluded = EXCLUDED_EMAILS.map(e => e.toLowerCase()).includes(email);
      
      const isDummy = isExcluded ||
                      email.includes('dummy') || email.includes('test') || email.includes('example') ||
                      fullName.includes('dummy') || fullName.includes('test') || fullName.includes('example') ||
                      id.includes('dummy') || id.includes('test') || id.includes('example');
                      
      if (!isDummy) {
        validUserIds.add(row.id);
        if (row.email) {
          validUserEmails.add(row.email.toLowerCase());
        }
      }
    });
    console.log(`Resolved ${validUserIds.size} valid non-dummy users and ${validUserEmails.size} emails from SQLite.\n`);
  } catch (err) {
    console.error("Error reading Users table to build filter map:", err.message);
  }

  // Helper function to check if a row is dummy data
  function shouldSkipRow(tableName, row) {
    // If it's the Users table, check if the ID is in our valid set
    if (tableName === 'Users') {
      return !validUserIds.has(row.id);
    }

    // List of user-reference fields in rows
    const userFields = ['user', 'userId', 'memberId', 'email', 'createdBy', 'participant', 'inspectedBy', 'requestedBy', 'reviewedBy', 'bvslLeader'];
    for (const field of userFields) {
      const val = row[field];
      if (val) {
        const valStr = String(val).toLowerCase();
        // Skip if the field contains dummy keywords
        if (valStr.includes('dummy') || valStr.includes('test') || valStr.includes('example')) {
          return true;
        }
        // Skip if the value is a user reference and is not in our valid set
        if (field === 'user' || field === 'userId' || field === 'memberId') {
          if (!validUserIds.has(val)) {
            return true;
          }
        }
        // Skip if the value is an email reference and is not in our valid set
        if (field === 'email') {
          if (!validUserEmails.has(valStr)) {
            return true;
          }
        }
      }
    }

    // Skip any group requests or sessions belonging to skipped users/groups
    if (tableName === 'BvGroups') {
      const leader = String(row.bvslLeader || '').toLowerCase();
      if (leader.includes('dummy') || leader.includes('test') || leader.includes('example')) {
        return true;
      }
    }

    return false;
  }

  for (const table of tables) {
    try {
      // Check if table exists in SQLite
      const checkTable = sqliteDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
      if (!checkTable) {
        continue;
      }

      // Fetch all rows
      const rows = sqliteDb.prepare(`SELECT * FROM "${table}"`).all();
      if (rows.length === 0) {
        continue;
      }

      // Filter out dummy rows
      const filteredRows = rows.filter(row => !shouldSkipRow(table, row));
      if (filteredRows.length === 0) {
        console.log(`Skipping table "${table}" (all rows were dummy/test data)`);
        continue;
      }

      console.log(`Migrating table "${table}" (${filteredRows.length} of ${rows.length} rows, skipping dummy data)...`);

      // Write in batches of 500 (Firestore batch limit)
      const batchSize = 500;
      for (let i = 0; i < filteredRows.length; i += batchSize) {
        const batch = firestore.batch();
        const chunk = filteredRows.slice(i, i + batchSize);

        for (const row of chunk) {
          const cleanRow = deserializeRow(table, row);
          const docId = cleanRow.id || `rec_${Math.random().toString(36).substring(2, 15)}`;
          cleanRow.id = docId;

          const docRef = firestore.collection(table).doc(docId);
          batch.set(docRef, cleanRow);
        }

        await batch.commit();
      }
      console.log(`   Completed table "${table}"`);
    } catch (err) {
      console.error(`✗ Error migrating table "${table}":`, err.message);
    }
  }
  console.log("\nAll data migrated successfully from SQLite to Firestore (dummy records excluded)!");
}

runMigration().catch(console.error);
