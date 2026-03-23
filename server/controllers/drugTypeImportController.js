const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');

/**
 * Import drug types from an uploaded CSV file stored on disk.
 */
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
  let successCount = 0;

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

  } catch (error) {
    console.error('💥 Error during import:', error);
    await db.query('ROLLBACK');
    res.status(500).json({
      status: false,
      message: 'Failed to import drug types',
      error: error.message,
      errors,
    });
  } finally {
    // Optional: cleanup uploaded file
    fs.unlink(filePath, (err) => {
      if (err) console.warn('⚠️ Failed to remove uploaded file:', err.message);
    });
  }
};

module.exports = { importDrugTypes };
