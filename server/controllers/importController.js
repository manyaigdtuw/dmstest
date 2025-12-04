const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');

const importDrugs = async (req, res) => {
  console.log('=== DRUG IMPORT CONTROLLER RUNNING ===');
  
  const db = req.app.locals.db;
  if (!req.file) {
    return res.status(400).json({ status: false, message: 'No file uploaded' });
  }

  console.log('File details:', {
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    path: req.file.path
  });

  const results = [];
  const errors = [];
  let successCount = 0;
  let drugNamesAdded = 0;

  try {
    // Check if file exists
    if (!req.file.path || !fs.existsSync(req.file.path)) {
      return res.status(400).json({ status: false, message: 'Uploaded file not found' });
    }

    console.log('Reading file from:', req.file.path);

    // Read from the saved file path
    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('headers', (headers) => {
          console.log('CSV Headers:', headers);
        })
        .on('data', (data) => {
          console.log('CSV row:', data);
          results.push(data);
        })
        .on('end', () => {
          console.log('CSV parsing completed. Total rows:', results.length);
          resolve();
        })
        .on('error', (error) => {
          console.error('CSV parsing error:', error);
          reject(error);
        });
    });

    console.log('Total rows to process:', results.length);

    if (results.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ 
        status: false, 
        message: 'No data found in CSV file' 
      });
    }

    // Process each record
    for (const [index, row] of results.entries()) {
      try {
        console.log(`\n--- Processing row ${index + 1} ---`);
        console.log('Row data:', row);
        
        // ✅ ONLY NAME IS REQUIRED
        const drugName = row.Name || row.name;
        
        console.log('Drug name found:', drugName);
        
        if (!drugName) {
          throw new Error('Drug name is required');
        }

        const drugType = row.Drug_Type || row['Drug Type'] || row.drug_type || null;
        console.log('Drug type found:', drugType);

        // STEP 1: Handle drug type and drug name linking
        let typeId = null;
        if (drugType && drugType.trim() !== '') {
          try {
            // Check if drug type exists
            const typeCheck = await db.query(
              'SELECT id FROM drug_types WHERE type_name = $1',
              [drugType.trim()]
            );

            if (typeCheck.rows.length === 0) {
              // Create the drug type if it doesn't exist
              console.log(`Creating new drug type: "${drugType}"`);
              const newType = await db.query(
                'INSERT INTO drug_types (type_name) VALUES ($1) RETURNING id',
                [drugType.trim()]
              );
              typeId = newType.rows[0].id;
              console.log(`✓ Created drug type with ID: ${typeId}`);
            } else {
              typeId = typeCheck.rows[0].id;
              console.log(`✓ Found existing drug type ID: ${typeId}`);
            }

            // STEP 2: Add drug name to drug_names table if it doesn't exist
            const nameCheck = await db.query(
              'SELECT id FROM drug_names WHERE type_id = $1 AND name = $2',
              [typeId, drugName.trim()]
            );

            if (nameCheck.rows.length === 0) {
              console.log(`Adding to drug_names: type_id=${typeId}, name="${drugName}"`);
              
              const nameResult = await db.query(
                'INSERT INTO drug_names (type_id, name) VALUES ($1, $2) RETURNING id',
                [typeId, drugName.trim()]
              );
              
              drugNamesAdded++;
              console.log(`✓ Added drug name with ID: ${nameResult.rows[0].id}`);
            } else {
              console.log(`✓ Drug name already exists in drug_names`);
            }

          } catch (typeError) {
            console.error(`Error in type/name processing:`, typeError);
            // Continue with drug import even if type/name linking fails
          }
        }

        // STEP 3: Import into drugs table
        const query = `
          INSERT INTO drugs (
            drug_type, name, batch_no, description, stock,
            mfg_date, exp_date, price, created_by, category
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id`;

        const values = [
          drugType,
          drugName,
          row.Batch_No || row['Batch No'] || row.batch_no || null,
          row.Description || row.description || '',
          parseInt(row.Stock || row.stock) || 0,
          null, // mfg_date - optional
          null, // exp_date - optional
          parseFloat(row.Price || row.price) || 0,
          req.user.id,
          row.Category || row.category || null,
        ];

        console.log('Inserting into drugs table with values:', values);
        const result = await db.query(query, values);
        successCount++;
        console.log(`✓ Row ${index + 1} imported successfully with ID: ${result.rows[0].id}`);
        
      } catch (error) {
        console.log(`✗ Row ${index + 1} error:`, error.message);
        errors.push({
          row: index + 2,
          error: error.message,
          data: row,
        });
      }
    }

    // Clean up: delete the uploaded file after processing
    fs.unlinkSync(req.file.path);
    console.log('Cleaned up uploaded file');

    console.log('=== IMPORT SUMMARY ===');
    console.log(`Drugs imported: ${successCount}`);
    console.log(`Drug names added: ${drugNamesAdded}`);

    res.status(200).json({
      status: true,
      message: `CSV import completed with ${successCount} drugs imported and ${drugNamesAdded} drug names added to catalog`,
      successCount,
      drugNamesAdded,
      errors,
    });

  } catch (error) {
    // Clean up file on error too
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    console.error('Error importing CSV:', error);
    res.status(500).json({ 
      status: false, 
      message: 'Failed to process CSV file',
      error: error.message 
    });
  }
};

module.exports = {
  importDrugs,
};