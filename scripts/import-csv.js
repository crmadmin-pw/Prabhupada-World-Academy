const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Simple CSV parser that handles quotes and commas
function parseCSV(content) {
  const lines = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"'; // escaped quote
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      row.push(cell.trim());
      if (row.some(c => c !== '')) {
        lines.push(row);
      }
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell.trim());
    lines.push(row);
  }
  return lines;
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log("Usage: node scripts/import-csv.js <path-to-csv> <target-table-name>");
    console.log("\nExample: node scripts/import-csv.js ./users.csv Users");
    process.exit(1);
  }

  const csvFilePath = path.resolve(process.cwd(), args[0]);
  const tableName = args[1];

  const dbPath = path.resolve(process.cwd(), 'sadhana.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`Error: SQLite database file not found at ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath);

  if (!fs.existsSync(csvFilePath)) {
    console.error(`Error: CSV file not found at ${csvFilePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(csvFilePath, 'utf8');
  const rows = parseCSV(content);

  if (rows.length < 2) {
    console.error("Error: CSV file must contain a header row and at least one data row.");
    process.exit(1);
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);

  // Get table columns and their types
  const pragma = db.prepare(`PRAGMA table_info("${tableName}")`).all();
  if (pragma.length === 0) {
    console.error(`Error: Table "${tableName}" does not exist in sadhana.db.`);
    process.exit(1);
  }

  const columnTypes = {};
  pragma.forEach(col => {
    columnTypes[col.name] = col.type.toUpperCase();
  });

  // Verify headers exist in the table columns
  const validHeaders = [];
  const missingHeaders = [];
  headers.forEach(h => {
    if (columnTypes[h] !== undefined) {
      validHeaders.push(h);
    } else {
      missingHeaders.push(h);
    }
  });

  if (missingHeaders.length > 0) {
    console.warn(`Warning: The following CSV columns do not exist in table "${tableName}" and will be skipped: ${missingHeaders.join(', ')}`);
  }

  if (validHeaders.length === 0) {
    console.error("Error: No matching columns found between the CSV header and the target table.");
    process.exit(1);
  }

  // Build the INSERT statement
  const placeholders = validHeaders.map(() => '?').join(', ');
  const columnsStr = validHeaders.map(h => `"${h}"`).join(', ');
  const insertStmt = db.prepare(`INSERT OR REPLACE INTO "${tableName}" (${columnsStr}) VALUES (${placeholders})`);

  console.log(`Starting import of ${dataRows.length} rows into table "${tableName}"...`);

  let successCount = 0;
  let errorCount = 0;

  const transaction = db.transaction(() => {
    for (let rIndex = 0; rIndex < dataRows.length; rIndex++) {
      const row = dataRows[rIndex];
      const params = [];

      for (let hIndex = 0; hIndex < headers.length; hIndex++) {
        const header = headers[hIndex];
        if (!validHeaders.includes(header)) continue;

        let val = row[hIndex];
        if (val === undefined || val === '' || val.toLowerCase() === 'null') {
          params.push(null);
          continue;
        }

        const type = columnTypes[header];
        if (type === 'INTEGER' || type === 'NUMERIC') {
          if (val.toLowerCase() === 'true') {
            params.push(1);
          } else if (val.toLowerCase() === 'false') {
            params.push(0);
          } else {
            const num = Number(val);
            params.push(isNaN(num) ? val : num);
          }
        } else if (type === 'BOOLEAN') {
          params.push(val.toLowerCase() === 'true' || val === '1' ? 1 : 0);
        } else {
          params.push(val);
        }
      }

      try {
        insertStmt.run(...params);
        successCount++;
      } catch (err) {
        console.error(`Row ${rIndex + 2} failed:`, err.message);
        errorCount++;
      }
    }
  });

  try {
    transaction();
    console.log(`\nImport completed successfully!`);
    console.log(`- Successfully imported/replaced: ${successCount} rows`);
    if (errorCount > 0) {
      console.log(`- Failed rows: ${errorCount}`);
    }
  } catch (err) {
    console.error("Transaction failed and was rolled back:", err.message);
  }
}

main();
