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
  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
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

    // Start transaction
    await db.query('BEGIN');

    // Process each record
    for (const [index, row] of results.entries()) {
      try {
        console.log(`\n--- Processing row ${index + 1} ---`);
        console.log('Row data:', row);
        
        // ✅ ALL FIELDS ARE REQUIRED EXCEPT DESCRIPTION AND CATEGORY
        // Validate required fields
        const requiredFields = [
          { key: 'Name', value: row.Name || row.name },
          { key: 'Drug_Type', value: row.Drug_Type || row['Drug Type'] || row.drug_type },
          { key: 'Batch_No', value: row.Batch_No || row['Batch No'] || row.batch_no },
          { key: 'Stock', value: row.Stock || row.stock },
          { key: 'Price', value: row.Price || row.price }
        ];

        const missingFields = requiredFields.filter(field => {
          const value = field.value;
          return value === undefined || value === null || value === '' || 
                 (typeof value === 'string' && value.trim() === '');
        });

        if (missingFields.length > 0) {
          throw new Error(`Missing required fields: ${missingFields.map(f => f.key).join(', ')}`);
        }

        const drugName = (row.Name || row.name).trim();
        const drugType = (row.Drug_Type || row['Drug Type'] || row.drug_type).trim();
        const batchNo = (row.Batch_No || row['Batch No'] || row.batch_no).trim();
        const stock = parseInt(row.Stock || row.stock);
        const price = parseFloat(row.Price || row.price);
        
        console.log('Validated fields:', { drugName, drugType, batchNo, stock, price });

        // Validate stock and price
        if (isNaN(stock) || stock < 0) {
          throw new Error(`Invalid stock value: ${row.Stock || row.stock}`);
        }
        
        if (isNaN(price) || price < 0) {
          throw new Error(`Invalid price value: ${row.Price || row.price}`);
        }

        // STEP 1: Handle drug type and drug name linking
        let typeId = null;
        try {
          // Check if drug type exists
          const typeCheck = await db.query(
            'SELECT id FROM drug_types WHERE type_name = $1',
            [drugType]
          );

          if (typeCheck.rows.length === 0) {
            // Create the drug type if it doesn't exist
            console.log(`Creating new drug type: "${drugType}"`);
            const newType = await db.query(
              'INSERT INTO drug_types (type_name) VALUES ($1) RETURNING id',
              [drugType]
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
            [typeId, drugName]
          );

          if (nameCheck.rows.length === 0) {
            console.log(`Adding to drug_names: type_id=${typeId}, name="${drugName}"`);
            
            const nameResult = await db.query(
              'INSERT INTO drug_names (type_id, name) VALUES ($1, $2) RETURNING id',
              [typeId, drugName]
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

        // STEP 3: Check if drug already exists (by batch_no and name) FOR THE SAME USER
        const existingDrug = await db.query(
          `SELECT * FROM drugs 
           WHERE name = $1 
           AND batch_no = $2 
           AND created_by = $3`,
          [drugName, batchNo, req.user.id]
        );

        const description = row.Description || row.description || '';
        const category = row.Category || row.category || null;

        // Prepare drug data
        const drugData = {
          drug_type: drugType,
          name: drugName,
          batch_no: batchNo,
          description: description,
          stock: stock,
          mfg_date: null,
          exp_date: null,
          price: price,
          category: category,
          updated_at: new Date()
        };

        // Parse dates if provided
        if (row['Manufacturing Date'] || row.mfg_date) {
          const mfgDate = parseDate(row['Manufacturing Date'] || row.mfg_date);
          if (mfgDate) drugData.mfg_date = mfgDate;
        }
        
        if (row['Expiration Date'] || row.exp_date) {
          const expDate = parseDate(row['Expiration Date'] || row.exp_date);
          if (expDate) drugData.exp_date = expDate;
        }

        if (existingDrug.rows.length > 0) {
          // Drug already exists for this user, UPDATE it with CSV values
          const drugId = existingDrug.rows[0].id;
          console.log(`✓ Found existing drug with ID: ${drugId} for user ${req.user.id}`);
          
          // Always update when entry exists (modify according to CSV values)
          console.log(`Updating existing drug ID: ${drugId} with CSV values`);
          
          const updateQuery = `
            UPDATE drugs 
            SET drug_type = $1, 
                description = $2, 
                stock = $3,
                mfg_date = $4,
                exp_date = $5,
                price = $6,
                category = $7,
                updated_at = $8
            WHERE id = $9
            RETURNING id`;
          
          const updateValues = [
            drugData.drug_type,
            drugData.description,
            drugData.stock,
            drugData.mfg_date,
            drugData.exp_date,
            drugData.price,
            drugData.category,
            drugData.updated_at,
            drugId
          ];
          
          console.log('Updating with values:', updateValues);
          const updateResult = await db.query(updateQuery, updateValues);
          updatedCount++;
          console.log(`✓ Updated drug with ID: ${updateResult.rows[0].id}`);
        } else {
          // Check if this drug exists for other users (to maintain uniqueness for this user)
          const otherUserDrug = await db.query(
            `SELECT * FROM drugs 
             WHERE name = $1 
             AND batch_no = $2 
             AND created_by != $3`,
            [drugName, batchNo, req.user.id]
          );

          if (otherUserDrug.rows.length > 0) {
            console.log(`Drug "${drugName}" with batch "${batchNo}" exists for other users. Adding for current user.`);
          }

          // New drug for this user, insert it
          console.log('Inserting new drug for current user...');
          
          const insertQuery = `
            INSERT INTO drugs (
              drug_type, name, batch_no, description, stock,
              mfg_date, exp_date, price, created_by, category, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id`;
          
          const insertValues = [
            drugData.drug_type,
            drugData.name,
            drugData.batch_no,
            drugData.description,
            drugData.stock,
            drugData.mfg_date,
            drugData.exp_date,
            drugData.price,
            req.user.id,
            drugData.category,
            new Date(),
            drugData.updated_at
          ];
          
          console.log('Inserting with values:', insertValues);
          const insertResult = await db.query(insertQuery, insertValues);
          addedCount++;
          console.log(`✓ Added new drug with ID: ${insertResult.rows[0].id}`);
        }
        
      } catch (error) {
        console.log(`✗ Row ${index + 1} error:`, error.message);
        errors.push({
          row: index + 2,
          error: error.message,
          data: row,
        });
      }
    }

    // Commit transaction
    await db.query('COMMIT');

    // Clean up: delete the uploaded file after processing
    fs.unlinkSync(req.file.path);
    console.log('Cleaned up uploaded file');

    console.log('=== IMPORT SUMMARY ===');
    console.log(`Drugs added: ${addedCount}`);
    console.log(`Drugs updated: ${updatedCount}`);
    console.log(`Drugs skipped (no changes): ${skippedCount}`);
    console.log(`Drug names added: ${drugNamesAdded}`);

    res.status(200).json({
      status: true,
      message: `CSV import completed: ${addedCount} added, ${updatedCount} updated, ${skippedCount} skipped`,
      summary: {
        added: addedCount,
        updated: updatedCount,
        skipped: skippedCount,
        drugNamesAdded: drugNamesAdded,
        total: results.length,
        errors: errors.length
      },
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    // Rollback transaction on error
    await db.query('ROLLBACK');
    
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

// Helper function to parse dates from various formats
function parseDate(dateString) {
  if (!dateString || typeof dateString !== 'string') return null;
  
  // Trim and clean the string
  const cleanString = dateString.trim();
  if (!cleanString) return null;
  
  // Try different date formats
  // Format: DD-MM-YYYY
  if (cleanString.match(/^\d{2}-\d{2}-\d{4}$/)) {
    const parts = cleanString.split('-');
    return new Date(parts[2], parts[1] - 1, parts[0]);
  }
  // Format: DD/MM/YYYY
  else if (cleanString.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
    const parts = cleanString.split('/');
    return new Date(parts[2], parts[1] - 1, parts[0]);
  }
  // Format: YYYY-MM-DD (ISO)
  else if (cleanString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return new Date(cleanString);
  }
  // Format: YYYY/MM/DD
  else if (cleanString.match(/^\d{4}\/\d{2}\/\d{2}$/)) {
    const parts = cleanString.split('/');
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  
  // Fallback to Date constructor
  const parsed = new Date(cleanString);
  return isNaN(parsed.getTime()) ? null : parsed;
}

module.exports = {
  importDrugs,
};