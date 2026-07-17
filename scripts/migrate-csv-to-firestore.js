const fs = require('fs');
const path = require('path');

// Manually parse .env file to load FIRESTORE_EMULATOR_HOST and other env variables
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

const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');


// List of all expected tables
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

// 1. Initialize Firebase Admin
const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error("Error: service-account.json not found in the root directory!");
  console.log("Please save your service account private key JSON as 'service-account.json' in the project root.");
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);
initializeApp({
  credential: cert(serviceAccount)
});

const firestore = getFirestore();
firestore.settings({ ignoreUndefinedProperties: true });

// CSV source directory
const CSV_DIR = path.resolve(process.cwd(), 'docs/zite-backups');

// 2. Simple Dependency-Free CSV Parser
function parseCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = [];
  let row = [];
  let inQuotes = false;
  let currentCell = '';

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentCell += '"';
          i++; // skip next quote
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\r' || char === '\n') {
        row.push(currentCell.trim());
        currentCell = '';
        if (row.length > 0 && row.some(cell => cell !== '')) {
          lines.push(row);
        }
        row = [];
        if (char === '\r' && nextChar === '\n') {
          i++; // skip LF of CRLF
        }
      } else {
        currentCell += char;
      }
    }
  }
  if (currentCell || row.length > 0) {
    row.push(currentCell.trim());
    if (row.length > 0 && row.some(cell => cell !== '')) {
      lines.push(row);
    }
  }

  if (lines.length === 0) return [];

  const headers = lines[0];
  return lines.slice(1).map(line => {
    const obj = {};
    headers.forEach((header, index) => {
      let val = line[index];
      if (val === 'NULL' || val === 'null' || val === '' || val === undefined) {
        val = null;
      }
      obj[header] = val;
    });
    return obj;
  });
}

// 3. Schema Parsing to cast types
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
      const colRegex = /"([^"]+)"\s+(\w+)|^\s*([a-zA-Z_]\w*)\s+(\w+)/gm;
      let colMatch;
      while ((colMatch = colRegex.exec(colDefs)) !== null) {
        if (colMatch[1]) {
          tableColumnTypes[tableName][colMatch[1]] = colMatch[2];
        } else if (colMatch[3]) {
          tableColumnTypes[tableName][colMatch[3]] = colMatch[4];
        }
      }
    }
  }
}

// Normalize raw CSV headers to match DB schema columns exactly
function normalizeRowKeys(tableName, rawRow) {
  const types = tableColumnTypes[tableName] || {};
  const expectedCols = Object.keys(types);
  
  const cleanRow = {};
  for (const rawCol of Object.keys(rawRow)) {
    const rawVal = rawRow[rawCol];
    // Remove spaces and lowercase to match
    const cleanColName = rawCol.replace(/\s+/g, '').toLowerCase();
    
    // Explicit 'id' column check
    if (cleanColName === 'id') {
      cleanRow['id'] = rawVal;
      continue;
    }
    
    // Find expected col name from schema
    const expectedCol = expectedCols.find(c => c.toLowerCase() === cleanColName);
    if (expectedCol) {
      cleanRow[expectedCol] = rawVal;
    } else {
      // Fallback: convert "Full Name" to "fullName" (camelCase)
      const camelColName = rawCol.replace(/\s+(.)/g, (match, group) => group.toUpperCase())
                                 .replace(/\s+/g, '')
                                 .replace(/^(.)/, (match, group) => group.toLowerCase());
      if (camelColName.toLowerCase() === 'id') {
        cleanRow['id'] = rawVal;
      } else {
        cleanRow[camelColName] = rawVal;
      }
    }
  }
  return cleanRow;
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
          // keep as string
        }
      }
    }
  }
  return newRow;
}

// Map CSV filename to target collection name
function getCollectionName(filename) {
  const withoutExtension = filename.replace(/\s*-\s*Grid\s*view\s*-\s*\d{4}-\d{2}-\d{2}\.csv$/i, '');
  const cleanName = withoutExtension.replace(/\s+/g, '');
  const matched = tables.find(t => t.toLowerCase() === cleanName.toLowerCase());
  return matched || null;
}

// Firestore Collection deletion helper
async function deleteCollection(collectionPath) {
  const collectionRef = firestore.collection(collectionPath);
  const snapshot = await collectionRef.limit(500).get();
  if (snapshot.size === 0) return;
  const batch = firestore.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  await deleteCollection(collectionPath);
}

// 4. Run Migration
async function runMigration() {
  console.log("Starting CSV to Firestore Migration (importing ALL records, no filtering)...\n");
  loadSchemaTypes();

  if (!fs.existsSync(CSV_DIR)) {
    console.error(`Error: CSV backup directory not found at ${CSV_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv') && f !== 'schema.csv');
  console.log(`Found ${files.length} CSV files in ${CSV_DIR}.`);

  // Group files by their Firestore collection name
  const collectionFiles = {};
  for (const file of files) {
    const colName = getCollectionName(file);
    if (!colName) {
      console.warn(`Warning: Could not map filename "${file}" to a database table. Skipping.`);
      continue;
    }
    if (!collectionFiles[colName]) {
      collectionFiles[colName] = [];
    }
    collectionFiles[colName].push(file);
  }

  const collectionsToMigrate = Object.keys(collectionFiles);
  console.log(`Grouped CSV files into ${collectionsToMigrate.length} collections.\n`);

  for (const colName of collectionsToMigrate) {
    try {
      console.log(`Wiping collection "${colName}"...`);
      await deleteCollection(colName);

      const targetFiles = collectionFiles[colName];
      let totalMigrated = 0;

      for (const file of targetFiles) {
        const filePath = path.join(CSV_DIR, file);
        const rawRows = parseCSV(filePath);
        if (rawRows.length === 0) continue;

        // Normalize keys for all rows
        const rows = rawRows.map(rawRow => normalizeRowKeys(colName, rawRow));

        const batchSize = 500;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = firestore.batch();
          const chunk = rows.slice(i, i + batchSize);

          for (const row of chunk) {
            const cleanRow = deserializeRow(colName, row);
            const docId = cleanRow.id || `rec_${Math.random().toString(36).substring(2, 15)}`;
            cleanRow.id = docId;

            const docRef = firestore.collection(colName).doc(docId);
            batch.set(docRef, cleanRow);
          }
          await batch.commit();
        }
        totalMigrated += rows.length;
      }

      console.log(`✓ Completed collection "${colName}": Migrated ${totalMigrated} docs`);
    } catch (err) {
      console.error(`✗ Error migrating collection "${colName}":`, err.message);
    }
  }

  console.log("\nAll CSV data successfully migrated to Firestore!");
}

runMigration().catch(console.error);

