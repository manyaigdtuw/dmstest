const recordDailyDispensing = async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.user.id;
  
  const {
    drug_id,
    quantity_dispensed,
    dispensing_date,
    category,
    notes
  } = req.body;

  try {
    // Validate date - only allow current date
    const currentDate = new Date().toISOString().split('T')[0];
    const requestedDate = dispensing_date || currentDate;
    
    if (requestedDate !== currentDate) {
      return res.status(400).json({
        status: false,
        message: `Entries can only be made for the current date (${currentDate})`
      });
    }

    await db.query('BEGIN');

    // Check drug availability and ownership
    const drugCheck = await db.query(
      'SELECT id, name, stock FROM drugs WHERE id = $1 AND created_by = $2',
      [drug_id, userId]
    );

    if (drugCheck.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({
        status: false,
        message: 'Drug not found in your inventory'
      });
    }

    const drug = drugCheck.rows[0];

    // Check if we have enough stock
    if (drug.stock < quantity_dispensed) {
      await db.query('ROLLBACK');
      return res.status(400).json({
        status: false,
        message: `Insufficient stock. Available: ${drug.stock}, Trying to dispense: ${quantity_dispensed}`
      });
    }

    // Check if record already exists for today
    const existingRecord = await db.query(
      `SELECT id, quantity_dispensed FROM daily_dispensing_summary 
       WHERE drug_id = $1 AND dispensing_date = $2 AND category = $3`,
      [drug_id, currentDate, category || 'OPD']
    );

    let result;
    if (existingRecord.rows.length > 0) {
      // Update existing record
      const existing = existingRecord.rows[0];
      const quantityDifference = quantity_dispensed - existing.quantity_dispensed;
      
      // Check if we have enough stock for the update
      if (drug.stock < quantityDifference) {
        await db.query('ROLLBACK');
        return res.status(400).json({
          status: false,
          message: `Insufficient stock for update. Available: ${drug.stock}, Additional needed: ${quantityDifference}`
        });
      }

      result = await db.query(
        `UPDATE daily_dispensing_summary 
         SET quantity_dispensed = $1, notes = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [quantity_dispensed, notes, existing.id]
      );

      // Update drug stock
      await db.query(
        'UPDATE drugs SET stock = stock - $1, updated_at = NOW() WHERE id = $2',
        [quantityDifference, drug_id]
      );

    } else {
      // Create new record
      result = await db.query(
        `INSERT INTO daily_dispensing_summary 
         (drug_id, quantity_dispensed, dispensing_date, category, notes, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          drug_id,
          quantity_dispensed,
          currentDate,
          category || 'OPD',
          notes,
          userId
        ]
      );

      // Update drug stock
      await db.query(
        'UPDATE drugs SET stock = stock - $1, updated_at = NOW() WHERE id = $2',
        [quantity_dispensed, drug_id]
      );
    }

    await db.query('COMMIT');

    // Get updated drug stock
    const updatedDrug = await db.query(
      'SELECT stock FROM drugs WHERE id = $1',
      [drug_id]
    );

    res.status(200).json({
      status: true,
      message: existingRecord.rows.length > 0 ? 'Dispensing record updated successfully' : 'Dispensing recorded successfully',
      dispensing: result.rows[0],
      updated_stock: updatedDrug.rows[0].stock
    });

  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Daily dispensing error:', err);
    
    if (err.code === '23505') { // Unique constraint violation
      return res.status(409).json({
        status: false,
        message: 'A dispensing record already exists for this drug and category today'
      });
    }
    
    res.status(500).json({
      status: false,
      message: 'Server error while recording dispensing',
      error: err.message
    });
  }
};

const importDispensingRecords = async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.user.id;
  
  const {
    dispensing_date = new Date().toISOString().split('T')[0],
    category = 'OPD'
  } = req.body;

  try {
    // Validate date - only allow current date
    const currentDate = new Date().toISOString().split('T')[0];
    if (dispensing_date !== currentDate) {
      return res.status(400).json({
        status: false,
        message: `Entries can only be imported for the current date (${currentDate})`
      });
    }

    if (!req.file) {
      return res.status(400).json({
        status: false,
        message: 'No CSV file uploaded'
      });
    }

    const csv = require('csv-parser');
    const fs = require('fs');
    const results = [];
    const errors = [];

    // Parse CSV file
    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', resolve)
        .on('error', reject);
    });

    await db.query('BEGIN');

    let importedCount = 0;

    for (const [index, record] of results.entries()) {
      try {
        const { drug_name, quantity_dispensed, notes = '' } = record;

        // Validate required fields
        if (!drug_name || !quantity_dispensed) {
          errors.push(`Row ${index + 1}: Missing required fields (drug_name, quantity_dispensed)`);
          continue;
        }

        // Validate quantity
        const quantity = parseInt(quantity_dispensed);
        if (isNaN(quantity) || quantity <= 0) {
          errors.push(`Row ${index + 1}: Invalid quantity '${quantity_dispensed}'`);
          continue;
        }

        // Find drug by name (case insensitive)
        const drugResult = await db.query(
          'SELECT id, name, stock FROM drugs WHERE LOWER(name) = LOWER($1) AND created_by = $2',
          [drug_name.trim(), userId]
        );

        if (drugResult.rows.length === 0) {
          errors.push(`Row ${index + 1}: Drug '${drug_name}' not found in your inventory`);
          continue;
        }

        const drug = drugResult.rows[0];

        // Check stock availability
        if (drug.stock < quantity) {
          errors.push(`Row ${index + 1}: Insufficient stock for '${drug_name}'. Available: ${drug.stock}, Required: ${quantity}`);
          continue;
        }

        // Check if record already exists for today and category
        const existingRecord = await db.query(
          `SELECT id, quantity_dispensed FROM daily_dispensing_summary 
           WHERE drug_id = $1 AND dispensing_date = $2 AND category = $3`,
          [drug.id, currentDate, category]
        );

        if (existingRecord.rows.length > 0) {
          // Update existing record
          const existing = existingRecord.rows[0];
          const quantityDifference = quantity - existing.quantity_dispensed;

          // Check if we have enough stock for the update
          if (drug.stock < quantityDifference) {
            errors.push(`Row ${index + 1}: Insufficient stock for update. Available: ${drug.stock}, Additional needed: ${quantityDifference}`);
            continue;
          }

          await db.query(
            `UPDATE daily_dispensing_summary 
             SET quantity_dispensed = $1, notes = $2, updated_at = NOW()
             WHERE id = $3`,
            [quantity, notes, existing.id]
          );

          // Update drug stock
          await db.query(
            'UPDATE drugs SET stock = stock - $1, updated_at = NOW() WHERE id = $2',
            [quantityDifference, drug.id]
          );
        } else {
          // Create new record
          await db.query(
            `INSERT INTO daily_dispensing_summary 
             (drug_id, quantity_dispensed, dispensing_date, category, notes, recorded_by)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              drug.id,
              quantity,
              currentDate,
              category,
              notes,
              userId
            ]
          );

          // Update drug stock
          await db.query(
            'UPDATE drugs SET stock = stock - $1, updated_at = NOW() WHERE id = $2',
            [quantity, drug.id]
          );
        }

        importedCount++;

      } catch (rowError) {
        errors.push(`Row ${index + 1}: ${rowError.message}`);
      }
    }

    await db.query('COMMIT');

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.status(200).json({
      status: true,
      message: `Import completed. ${importedCount} records imported successfully.`,
      imported: importedCount,
      total: results.length,
      errors: errors
    });

  } catch (err) {
    await db.query('ROLLBACK');
    
    // Clean up uploaded file in case of error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error('CSV import error:', err);
    res.status(500).json({
      status: false,
      message: 'Server error while importing CSV',
      error: err.message
    });
  }
};

const getDailyDispensing = async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.user.id;
  
  const {
    date = new Date().toISOString().split('T')[0], // Default to today
    category,
    page = 1,
    limit = 50
  } = req.query;

  try {
    let query = `
      SELECT 
        dds.*,
        d.name as drug_name,
        d.batch_no,
        d.stock as current_stock,
        u.name as recorded_by_name
      FROM daily_dispensing_summary dds
      JOIN drugs d ON dds.drug_id = d.id
      JOIN users u ON dds.recorded_by = u.id
      WHERE d.created_by = $1 AND dds.dispensing_date = $2
    `;
    
    const queryParams = [userId, date];
    let paramCount = 3;

    if (category && category !== 'all') {
      query += ` AND dds.category = $${paramCount}`;
      queryParams.push(category);
      paramCount++;
    }

    query += ` ORDER BY d.name 
               LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    
    queryParams.push(limit, (page - 1) * limit);

    const result = await db.query(query, queryParams);

    // Count query
    let countQuery = `
      SELECT COUNT(*) 
      FROM daily_dispensing_summary dds
      JOIN drugs d ON dds.drug_id = d.id
      WHERE d.created_by = $1 AND dds.dispensing_date = $2
    `;
    const countParams = [userId, date];

    if (category && category !== 'all') {
      countQuery += ` AND dds.category = $3`;
      countParams.push(category);
    }

    const countResult = await db.query(countQuery, countParams);

    res.json({
      status: true,
      records: result.rows,
      date: date,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });

  } catch (err) {
    console.error('Get daily dispensing error:', err);
    res.status(500).json({
      status: false,
      message: 'Server error while fetching daily dispensing records',
      error: err.message
    });
  }
};

const getTodayDispensing = async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.user.id;
  
  try {
    const result = await db.query(
      `SELECT 
        dds.*,
        d.name as drug_name,
        d.batch_no,
        d.stock as current_stock,
        u.name as recorded_by_name
       FROM daily_dispensing_summary dds
       JOIN drugs d ON dds.drug_id = d.id
       JOIN users u ON dds.recorded_by = u.id
       WHERE d.created_by = $1 AND dds.dispensing_date = CURRENT_DATE
       ORDER BY d.name`,
      [userId]
    );

    // Calculate totals
    const totalDispensed = result.rows.reduce((sum, record) => sum + record.quantity_dispensed, 0);
    const totalDrugs = result.rows.length;

    res.json({
      status: true,
      records: result.rows,
      summary: {
        total_dispensed: totalDispensed,
        total_drugs: totalDrugs,
        date: new Date().toISOString().split('T')[0]
      }
    });

  } catch (err) {
    console.error('Get today dispensing error:', err);
    res.status(500).json({
      status: false,
      message: 'Server error while fetching today\'s dispensing records',
      error: err.message
    });
  }
};

const getDispensingSummary = async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.user.id;
  
  const { start_date, end_date } = req.query;

  try {
    const result = await db.query(
      `SELECT 
        dds.dispensing_date,
        COUNT(dds.id) as drugs_dispensed,
        SUM(dds.quantity_dispensed) as total_quantity,
        dds.category
       FROM daily_dispensing_summary dds
       JOIN drugs d ON dds.drug_id = d.id
       WHERE d.created_by = $1 
         AND dds.dispensing_date BETWEEN $2 AND $3
       GROUP BY dds.dispensing_date, dds.category
       ORDER BY dds.dispensing_date DESC, dds.category`,
      [userId, start_date, end_date || start_date]
    );

    res.json({
      status: true,
      summary: result.rows
    });

  } catch (err) {
    console.error('Get dispensing summary error:', err);
    res.status(500).json({
      status: false,
      message: 'Server error while fetching dispensing summary',
      error: err.message
    });
  }
};

const deleteDispensingRecord = async (req, res) => {
  const db = req.app.locals.db;
  const { id } = req.params;
  const userId = req.user.id;

  try {
    await db.query('BEGIN');

    // Get the record to restore stock
    const recordResult = await db.query(
      `SELECT dds.quantity_dispensed, dds.drug_id 
       FROM daily_dispensing_summary dds
       JOIN drugs d ON dds.drug_id = d.id
       WHERE dds.id = $1 AND d.created_by = $2`,
      [id, userId]
    );

    if (recordResult.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({
        status: false,
        message: 'Record not found or not authorized'
      });
    }

    const record = recordResult.rows[0];

    // Restore drug stock
    await db.query(
      'UPDATE drugs SET stock = stock + $1, updated_at = NOW() WHERE id = $2',
      [record.quantity_dispensed, record.drug_id]
    );

    // Delete the record
    await db.query(
      'DELETE FROM daily_dispensing_summary WHERE id = $1',
      [id]
    );

    await db.query('COMMIT');

    res.json({
      status: true,
      message: 'Dispensing record deleted and stock restored successfully'
    });

  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Delete dispensing record error:', err);
    res.status(500).json({
      status: false,
      message: 'Server error while deleting dispensing record',
      error: err.message
    });
  }
};




module.exports = {
  recordDailyDispensing,
  getDailyDispensing,
  getTodayDispensing,
  getDispensingSummary,
  deleteDispensingRecord,
  importDispensingRecords 

};