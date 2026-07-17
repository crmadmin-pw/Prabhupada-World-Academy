/**
 * Parse a CSV string into an array of string arrays.
 * Handles quoted fields with commas and newlines.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        row.push(field);
        field = '';
        if (row.some(c => c.trim())) rows.push(row);
        row = [];
        if (ch === '\r') i++;
      } else {
        field += ch;
      }
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some(c => c.trim())) rows.push(row);
  }
  return rows;
}

function isValidValue(value: string): boolean {
  const v = (value || '').trim().toUpperCase();
  return !!v && v !== 'N/A' && v !== 'NA' && v !== '-';
}

export function parseRegistrationCsv(text: string) {
  const csv = parseCsv(text);
  if (csv.length < 2) return [];

  const headers = csv[0].map(h => h.trim());
  const idx = {
    name: headers.indexOf('name'),
    email: headers.indexOf('email'),
    phone: headers.indexOf('phone'),
    state: headers.indexOf('Subscriber State'),
    mango: headers.indexOf('Mango Name'),
    affiliate: headers.indexOf('Affiliate Name'),
    affiliateEmail: headers.indexOf('Affiliate Email'),
    affiliatePhone: headers.indexOf('Affiliate Phone'),
    age: headers.indexOf('Age'),
    ageAlt: headers.indexOf('Age_'),
    gender: headers.indexOf('Gender'),
    city: headers.indexOf('City'),
    occupation: headers.indexOf('Occupation'),
    occupationAlt: headers.indexOf('Occupation_'),
    attendance: headers.indexOf('How_You_Wish_to_Attend_the_Jigyasa_Program'),
  };

  const rows: { name: string; email: string; phone: string; state: string; mangoName: string; affiliateName: string; affiliateEmail: string; affiliatePhone: string; age: string; gender: string; city: string; occupation: string; attendanceMode: string }[] = [];
  for (let i = 1; i < csv.length; i++) {
    const row = csv[i];
    const email = (row[idx.email] || '').trim();
    if (!email) continue;

    const age = [idx.age, idx.ageAlt]
      .filter(j => j >= 0)
      .map(j => row[j])
      .find(isValidValue) || '';

    const occupation = [idx.occupation, idx.occupationAlt]
      .filter(j => j >= 0)
      .map(j => row[j])
      .find(isValidValue) || '';

    rows.push({
      name: row[idx.name] || '',
      email,
      phone: idx.phone >= 0 ? row[idx.phone] || '' : '',
      state: idx.state >= 0 ? row[idx.state] || '' : '',
      mangoName: idx.mango >= 0 ? row[idx.mango] || '' : '',
      affiliateName: idx.affiliate >= 0 ? row[idx.affiliate] || '' : '',
      affiliateEmail: idx.affiliateEmail >= 0 ? row[idx.affiliateEmail] || '' : '',
      affiliatePhone: idx.affiliatePhone >= 0 ? row[idx.affiliatePhone] || '' : '',
      age,
      gender: idx.gender >= 0 ? row[idx.gender] || '' : '',
      city: idx.city >= 0 ? row[idx.city] || '' : '',
      occupation,
      attendanceMode: idx.attendance >= 0 ? row[idx.attendance] || '' : '',
    });
  }
  return rows;
}

export function parseAttendanceCsv(text: string) {
  const csv = parseCsv(text);
  if (csv.length < 2) return [];

  const headers = csv[0].map(h => h.trim());
  const emailIdx = headers.indexOf('user_email');
  const durationIdx = headers.indexOf('duration');
  const nameIdx = headers.indexOf('name');

  if (emailIdx < 0) return [];

  const rows: { name: string; email: string; duration: string }[] = [];
  for (let i = 1; i < csv.length; i++) {
    const row = csv[i];
    const email = (row[emailIdx] || '').trim();
    if (!email) continue;
    rows.push({
      name: nameIdx >= 0 ? row[nameIdx] || '' : '',
      email,
      duration: durationIdx >= 0 ? row[durationIdx] || '' : '',
    });
  }
  return rows;
}

export function extractDateFromFilename(filename: string): string | null {
  const match = filename.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}
