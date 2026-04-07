const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');


const importDrugTypes = async (req, res) => {
  const db = req.app.locals.db;

  if (!req.file) {
    return res.status(400).json({
      status: false,
      message: 'No file uploaded',
    });
  }

  const filePath = path.resolve(req.file.path);
  const results = [];
  const errors = [];

  try {
    console.log('🧩 Starting CSV import...');
    console.log('Uploaded file:', filePath);

    // --- Parse CSV from file ---
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv({
          headers: false,
          skipEmptyLines: true,
          trim: true,
        }))
        .on('data', (data) => {
          const row = Object.values(data).filter(v => v && v.trim() !== '');
          if (row.length > 0) results.push(row);
        })
        .on('end', resolve)
        .on('error', reject);
    });

    console.log(`📄 Parsed ${results.length} rows from ${req.file.originalname}`);

    // Check if we have single column (drug types only) or two columns (drug types + names)
    const hasTwoColumns = results.some(row => row.length >= 2 && row[1] && row[1].trim() !== '');

    if (hasTwoColumns) {
      console.log('📋 Detected two-column format: Drug Type and Drug Name');
      await importDrugTypesAndNames(db, results, errors, req, res);
    } else {
      console.log('📋 Detected single-column format: Drug Type only');
      await importDrugTypesOnly(db, results, errors, req, res);
    }
  } catch (error) {
    console.error('💥 Error during import:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to import drug types',
      error: error.message,
      errors,
    });
  } finally {
    // Cleanup uploaded file
    fs.unlink(filePath, (err) => {
      if (err) console.warn('⚠️ Failed to remove uploaded file:', err.message);
    });
  }
};

/**
 * Import drug types only (single column format)
 */
const importDrugTypesOnly = async (db, results, errors, req, res) => {
  let successCount = 0;
  const drugTypes = new Set();

  for (let i = 0; i < results.length; i++) {
    const type = results[i][0]?.trim();

    if (!type) continue;

    // Skip header row dynamically
    if (i === 0 && /^drug.?types?/i.test(type)) {
      console.log(`🪶 Skipping header row: "${type}"`);
      continue;
    }

    drugTypes.add(type);
  }

  console.log(`✅ Found ${drugTypes.size} unique drug types`);

  if (drugTypes.size === 0) {
    return res.status(400).json({
      status: false,
      message: 'No valid drug types found in CSV',
    });
  }

  // --- Insert into DB ---
  await db.query('BEGIN');
  const inserted = [];

  for (const type of drugTypes) {
    try {
      const result = await db.query(
        `INSERT INTO drug_types (type_name)
         VALUES ($1)
         ON CONFLICT (type_name)
         DO UPDATE SET type_name = EXCLUDED.type_name
         RETURNING *`,
        [type]
      );
      inserted.push(result.rows[0]);
      successCount++;
    } catch (err) {
      console.error(`❌ Failed to insert "${type}":`, err.message);
      errors.push({ drugType: type, error: err.message });
    }
  }

  await db.query('COMMIT');
  console.log(`🎯 Import done: ${successCount} inserted, ${errors.length} failed`);

  res.json({
    status: true,
    message: 'Import completed successfully',
    successCount,
    totalCount: drugTypes.size,
    insertedDrugTypes: inserted,
    errors,
  });
};

/**
 * Import drug types and drug names (two column format)
 */
const importDrugTypesAndNames = async (db, results, errors, req, res) => {
  let typeSuccessCount = 0;
  let nameSuccessCount = 0;
  const typeMap = new Map(); // To store type_id for each type_name
  const insertedTypes = [];
  const insertedNames = [];

  // --- First pass: Collect all unique drug types ---
  const drugTypes = new Set();
  for (let i = 0; i < results.length; i++) {
    const type = results[i][0]?.trim();
    if (!type) continue;

    // Skip header row
    if (i === 0 && /^drug.?types?/i.test(type)) {
      console.log(`🪶 Skipping header row: "${type}"`);
      continue;
    }

    drugTypes.add(type);
  }

  console.log(`✅ Found ${drugTypes.size} unique drug types`);

  if (drugTypes.size === 0) {
    return res.status(400).json({
      status: false,
      message: 'No valid drug types found in CSV',
    });
  }

  // --- Insert drug types ---
  await db.query('BEGIN');

  for (const type of drugTypes) {
    try {
      const result = await db.query(
        `INSERT INTO drug_types (type_name)
         VALUES ($1)
         ON CONFLICT (type_name)
         DO UPDATE SET type_name = EXCLUDED.type_name
         RETURNING *`,
        [type]
      );
      typeMap.set(type, result.rows[0].id);
      insertedTypes.push(result.rows[0]);
      typeSuccessCount++;
    } catch (err) {
      console.error(`❌ Failed to insert drug type "${type}":`, err.message);
      errors.push({ drugType: type, error: err.message });
    }
  }

  // --- Second pass: Insert drug names ---
  for (let i = 0; i < results.length; i++) {
    const type = results[i][0]?.trim();
    const name = results[i][1]?.trim();

    if (!type || !name) continue;

    // Skip header row
    if (i === 0 && /^drug.?types?/i.test(type)) continue;

    const typeId = typeMap.get(type);
    if (!typeId) {
      errors.push({
        drugType: type,
        drugName: name,
        error: 'Type not found in map'
      });
      continue;
    }

    try {
      const result = await db.query(
        `INSERT INTO drug_names (type_id, name)
         VALUES ($1, $2)
         ON CONFLICT (type_id, name)
         DO UPDATE SET name = EXCLUDED.name
         RETURNING *`,
        [typeId, name]
      );
      insertedNames.push(result.rows[0]);
      nameSuccessCount++;
    } catch (err) {
      console.error(`❌ Failed to insert drug name "${name}" for type "${type}":`, err.message);
      errors.push({
        drugType: type,
        drugName: name,
        error: err.message
      });
    }
  }

  await db.query('COMMIT');
  console.log(`🎯 Import done: ${typeSuccessCount} types, ${nameSuccessCount} names, ${errors.length} failed`);

  res.json({
    status: true,
    message: 'Import completed successfully',
    typeSuccessCount,
    nameSuccessCount,
    totalTypes: drugTypes.size,
    insertedDrugTypes: insertedTypes,
    insertedDrugNames: insertedNames,
    errors,
  });
};

module.exports = { importDrugTypes, importDrugTypesOnly, importDrugTypesAndNames };
