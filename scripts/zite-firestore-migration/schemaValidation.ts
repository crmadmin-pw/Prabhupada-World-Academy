/* eslint-disable @typescript-eslint/no-explicit-any -- Zite schema payload is external JSON */

export interface SchemaValidationReport {
  tableCount: number;
  configuredTableCount: number;
  exactlyConfiguredTables: boolean;
  linkedRecordFieldCount: number;
  orphanedLinkedRecordFields: string[];
}

export function validateZiteSchema(schemaTables: any[], configuredTableNames: string[]): SchemaValidationReport {
  const schemaNames = schemaTables.map((table) => String(table?.name ?? ''));
  const uniqueSchemaNames = new Set(schemaNames);
  if (uniqueSchemaNames.size !== schemaNames.length) throw new Error('Zite schema contains duplicate table names');

  const configuredNames = new Set(configuredTableNames);
  const missing = [...configuredNames].filter((name) => !uniqueSchemaNames.has(name));
  const unexpected = [...uniqueSchemaNames].filter((name) => !configuredNames.has(name));
  if (missing.length || unexpected.length) {
    throw new Error(`Zite schema/config mismatch: missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}`);
  }

  const linkedFields = schemaTables.flatMap((table) =>
    (table.fields ?? [])
      .filter((field: any) => field.type === 'linked_record')
      .map((field: any) => ({ table: table.name, field: field.name, linksTo: field.linksTo })),
  );
  const orphaned = linkedFields
    .filter((field) => !field.linksTo || !uniqueSchemaNames.has(String(field.linksTo)))
    .map((field) => `${field.table}.${field.field}->${field.linksTo ?? '(missing)'}`);
  if (orphaned.length) throw new Error(`Zite schema has orphaned linked-record fields: ${JSON.stringify(orphaned)}`);

  return {
    tableCount: schemaNames.length,
    configuredTableCount: configuredTableNames.length,
    exactlyConfiguredTables: true,
    linkedRecordFieldCount: linkedFields.length,
    orphanedLinkedRecordFields: [],
  };
}
