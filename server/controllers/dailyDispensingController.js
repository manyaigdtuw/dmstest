const recordDailyDispensing = async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.user.id;
  const userRole = req.user.role;

  const {
    drug_id,
    quantity_dispensed,
    dispensing_date,
    category,
    notes,
    batch_no
  } = req.body;

  try {
    const currentDate = new Date().toISOString().split('T')[0];
    const requestedDate = dispensing_date || currentDate;

    if (requestedDate !== currentDate) {
      return res.status(400).json({
        status: false,
        message: `Entries can only be made for the current date (${currentDate})`
      });
    }

    await db.query('BEGIN');

    // Get current stock based on user role
    let currentStock;
    let drugDetails;

    if (userRole === 'pharmacy') {
      // For pharmacy: calculate stock from approved orders minus already dispensed
      const stockResult = await db.query(`
        WITH approved_inventory AS (
          SELECT
            d.id,
            d.name,
            d.batch_no,
            COALESCE(SUM(oi.quantity), 0) as approved_quantity
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          JOIN drugs d ON oi.drug_id = d.id
          WHERE oi.drug_id = $1
            AND o.user_id = $2
            AND oi.status = 'approved'
            AND o.transaction_type = 'institute'
          GROUP BY d.id, d.name, d.batch_no
        ),
        dispensed_total AS (
          SELECT
            COALESCE(SUM(quantity_dispensed), 0) as total_dispensed
          FROM daily_dispensing_summary
          WHERE drug_id = $1
        )
        SELECT
          ai.id,
          ai.name,
          ai.batch_no,
          ai.approved_quantity,
          GREATEST(ai.approved_quantity - COALESCE(dt.total_dispensed, 0), 0) as current_stock
        FROM approved_inventory ai
        CROSS JOIN dispensed_total dt
      `, [drug_id, userId]);

      if (stockResult.rows.length === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({
          status: false,
          message: 'Drug not found in pharmacy inventory'
        });
      }

      drugDetails = stockResult.rows[0];
      currentStock = parseInt(drugDetails.current_stock);
    } else {
      // For institutes: get stock from drugs table
      const drugResult = await db.query(
        'SELECT id, name, stock, batch_no FROM drugs WHERE id = $1 AND created_by = $2',
        [drug_id, userId]
      );

      if (drugResult.rows.length === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({
          status: false,
          message: 'Drug not found in your inventory'
        });
      }

      drugDetails = drugResult.rows[0];
      currentStock = parseInt(drugDetails.stock);
    }

    // Validate stock
    const quantity = parseInt(quantity_dispensed);
    if (currentStock < quantity) {
      await db.query('ROLLBACK');
      return res.status(400).json({
        status: false,
        message: `Insufficient stock. Available: ${currentStock}, Trying to dispense: ${quantity}`
      });
    }

    // Check for existing record
    const existingRecord = await db.query(
      `SELECT id, quantity_dispensed FROM daily_dispensing_summary
       WHERE drug_id = $1 AND dispensing_date = $2 AND category = $3`,
      [drug_id, currentDate, category || 'OPD']
    );

    let result;
    if (existingRecord.rows.length > 0) {
      const existing = existingRecord.rows[0];
      const quantityDifference = quantity - existing.quantity_dispensed;

      // For institutes only: check stock difference
      if (userRole !== 'pharmacy' && quantityDifference > 0) {
        if (currentStock < quantityDifference) {
          await db.query('ROLLBACK');
          return res.status(400).json({
            status: false,
            message: `Insufficient stock for update. Available: ${currentStock}, Additional needed: ${quantityDifference}`
          });
        }
      }

      // Update existing record
      result = await db.query(
        `UPDATE daily_dispensing_summary
         SET quantity_dispensed = $1, notes = $2, batch_no = $3, updated_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [quantity, notes, batch_no || drugDetails.batch_no, existing.id]
      );

      // Update stock for institutes only (pharmacy stock is calculated dynamically)
      if (userRole !== 'pharmacy' && quantityDifference !== 0) {
        await db.query(
          'UPDATE drugs SET stock = stock - $1, updated_at = NOW() WHERE id = $2',
          [quantityDifference, drug_id]
        );
      }
    } else {
      // Insert new record
      result = await db.query(
        `INSERT INTO daily_dispensing_summary
         (drug_id, quantity_dispensed, dispensing_date, category, notes, batch_no, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [drug_id, quantity, currentDate, category || 'OPD', notes, batch_no || drugDetails.batch_no, userId]
      );

      // Update stock for institutes only
      if (userRole !== 'pharmacy') {
        await db.query(
          'UPDATE drugs SET stock = stock - $1, updated_at = NOW() WHERE id = $2',
          [quantity, drug_id]
        );
      }
    }

    await db.query('COMMIT');

    // Calculate updated stock for response
    let updatedStock;
    if (userRole === 'pharmacy') {
      const stockResult = await db.query(`
        WITH approved_inventory AS (
          SELECT COALESCE(SUM(oi.quantity), 0) as approved_quantity
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          WHERE oi.drug_id = $1
            AND o.user_id = $2
            AND oi.status = 'approved'
            AND o.transaction_type = 'institute'
        ),
        dispensed_total AS (
          SELECT COALESCE(SUM(quantity_dispensed), 0) as total_dispensed
          FROM daily_dispensing_summary
          WHERE drug_id = $1
        )
        SELECT 
          GREATEST(
            (SELECT approved_quantity FROM approved_inventory) - 
            (SELECT total_dispensed FROM dispensed_total), 
            0
          ) as current_stock
      `, [drug_id, userId]);

      updatedStock = stockResult.rows[0]?.current_stock || 0;
    } else {
      const stockResult = await db.query(
        'SELECT stock FROM drugs WHERE id = $1',
        [drug_id]
      );
      updatedStock = stockResult.rows[0]?.stock || 0;
    }

    res.status(200).json({
      status: true,
      message: existingRecord.rows.length > 0 ? 'Dispensing record updated successfully' : 'Dispensing recorded successfully',
      dispensing: result.rows[0],
      updated_stock: updatedStock
    });

  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Daily dispensing error:', err);

    if (err.code === '23505') {
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
  const userRole = req.user.role;

  const { dispensing_date = new Date().toISOString().split('T')[0], category = 'OPD' } = req.body;

  try {
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

        if (!drug_name || !quantity_dispensed) {
          errors.push(`Row ${index + 1}: Missing required fields (drug_name, quantity_dispensed)`);
          continue;
        }

        const quantity = parseInt(quantity_dispensed);
        if (isNaN(quantity) || quantity <= 0) {
          errors.push(`Row ${index + 1}: Invalid quantity '${quantity_dispensed}'`);
          continue;
        }

        let drugResult;
        if (userRole === 'pharmacy') {
          drugResult = await db.query(`
            SELECT d.id, d.name, COALESCE(SUM(oi.quantity), 0) as stock
            FROM drugs d
            JOIN order_items oi ON oi.drug_id = d.id
            JOIN orders o ON oi.order_id = o.id
            WHERE LOWER(d.name) = LOWER($1)
              AND o.user_id = $2
              AND oi.status = 'approved'
              AND o.transaction_type = 'institute'
            GROUP BY d.id, d.name
          `, [drug_name.trim(), userId]);
        } else {
          drugResult = await db.query(
            'SELECT id, name, stock FROM drugs WHERE LOWER(name) = LOWER($1) AND created_by = $2',
            [drug_name.trim(), userId]
          );
        }

        if (drugResult.rows.length === 0) {
          errors.push(`Row ${index + 1}: Drug '${drug_name}' not found in your inventory`);
          continue;
        }

        const drug = drugResult.rows[0];

        if (parseInt(drug.stock) < quantity) {
          errors.push(`Row ${index + 1}: Insufficient stock for '${drug_name}'. Available: ${drug.stock}, Required: ${quantity}`);
          continue;
        }

        const existingRecord = await db.query(
          `SELECT id, quantity_dispensed FROM daily_dispensing_summary
           WHERE drug_id = $1 AND dispensing_date = $2 AND category = $3`,
          [drug.id, currentDate, category]
        );

        if (existingRecord.rows.length > 0) {
          const existing = existingRecord.rows[0];
          const quantityDifference = quantity - existing.quantity_dispensed;

          if (parseInt(drug.stock) < quantityDifference) {
            errors.push(`Row ${index + 1}: Insufficient stock for update. Available: ${drug.stock}, Additional needed: ${quantityDifference}`);
            continue;
          }

          await db.query(
            `UPDATE daily_dispensing_summary
             SET quantity_dispensed = $1, notes = $2, updated_at = NOW()
             WHERE id = $3`,
            [quantity, notes, existing.id]
          );

          if (userRole !== 'pharmacy') {
            await db.query(
              'UPDATE drugs SET stock = stock - $1, updated_at = NOW() WHERE id = $2',
              [quantityDifference, drug.id]
            );
          }
        } else {
          await db.query(
            `INSERT INTO daily_dispensing_summary
             (drug_id, quantity_dispensed, dispensing_date, category, notes, recorded_by)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [drug.id, quantity, currentDate, category, notes, userId]
          );

          if (userRole !== 'pharmacy') {
            await db.query(
              'UPDATE drugs SET stock = stock - $1, updated_at = NOW() WHERE id = $2',
              [quantity, drug.id]
            );
          }
        }

        importedCount++;
      } catch (rowError) {
        errors.push(`Row ${index + 1}: ${rowError.message}`);
      }
    }

    await db.query('COMMIT');
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
  const userRole = req.user.role;

  const { date = new Date().toISOString().split('T')[0], category, page = 1, limit = 50 } = req.query;

  try {
    const offset = (page - 1) * limit;
    let result, countResult;

    if (userRole === 'pharmacy') {
      const categoryFilter = category && category !== 'all' ? 'AND dds.category = $3' : '';
      const params = category && category !== 'all'
        ? [userId, date, category, limit, offset]
        : [userId, date, limit, offset];
      const limitIdx = category && category !== 'all' ? '$4' : '$3';
      const offsetIdx = category && category !== 'all' ? '$5' : '$4';

      result = await db.query(`
        WITH approved_inventory AS (
          SELECT
            d.id,
            d.name,
            d.batch_no,
            COALESCE(SUM(oi.quantity), 0) as approved_quantity
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          JOIN drugs d ON oi.drug_id = d.id
          WHERE o.user_id = $1
            AND oi.status = 'approved'
            AND o.transaction_type = 'institute'
          GROUP BY d.id, d.name, d.batch_no
        ),
        dispensed_total AS (
          SELECT
            drug_id,
            COALESCE(SUM(quantity_dispensed), 0) as total_dispensed
          FROM daily_dispensing_summary
          WHERE dispensing_date <= $2
          GROUP BY drug_id
        )
        SELECT
          dds.*,
          ai.name as drug_name,
          ai.batch_no,
          GREATEST(ai.approved_quantity - COALESCE(dt.total_dispensed, 0), 0) as current_stock,
          u.name as recorded_by_name
        FROM daily_dispensing_summary dds
        JOIN approved_inventory ai ON dds.drug_id = ai.id
        JOIN users u ON dds.recorded_by = u.id
        LEFT JOIN dispensed_total dt ON dds.drug_id = dt.drug_id
        WHERE dds.dispensing_date = $2
          ${categoryFilter}
        ORDER BY ai.name
        LIMIT ${limitIdx} OFFSET ${offsetIdx}
      `, params);

      const countParams = category && category !== 'all' ? [userId, date, category] : [userId, date];
      countResult = await db.query(`
        SELECT COUNT(*)
        FROM daily_dispensing_summary dds
        JOIN (
          SELECT d.id
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          JOIN drugs d ON oi.drug_id = d.id
          WHERE o.user_id = $1
            AND oi.status = 'approved'
            AND o.transaction_type = 'institute'
          GROUP BY d.id
        ) inv ON dds.drug_id = inv.id
        WHERE dds.dispensing_date = $2
          ${categoryFilter}
      `, countParams);
    } else {
      const categoryFilter = category && category !== 'all' ? 'AND dds.category = $3' : '';
      const params = category && category !== 'all'
        ? [userId, date, category, limit, offset]
        : [userId, date, limit, offset];
      const limitIdx = category && category !== 'all' ? '$4' : '$3';
      const offsetIdx = category && category !== 'all' ? '$5' : '$4';

      result = await db.query(`
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
          ${categoryFilter}
        ORDER BY d.name
        LIMIT ${limitIdx} OFFSET ${offsetIdx}
      `, params);

      const countParams = category && category !== 'all' ? [userId, date, category] : [userId, date];
      countResult = await db.query(`
        SELECT COUNT(*)
        FROM daily_dispensing_summary dds
        JOIN drugs d ON dds.drug_id = d.id
        WHERE d.created_by = $1 AND dds.dispensing_date = $2
          ${categoryFilter}
      `, countParams);
    }

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
  const userRole = req.user.role;

  try {
    let result;

    if (userRole === 'pharmacy') {
      // For pharmacy users, calculate remaining stock by subtracting total dispensed from approved quantity
      result = await db.query(`
        WITH approved_inventory AS (
          SELECT
            d.id,
            d.name,
            d.batch_no,
            COALESCE(SUM(oi.quantity), 0) as approved_quantity
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          JOIN drugs d ON oi.drug_id = d.id
          WHERE o.user_id = $1
            AND oi.status = 'approved'
            AND o.transaction_type = 'institute'
          GROUP BY d.id, d.name, d.batch_no
        ),
        dispensed_total AS (
          SELECT
            drug_id,
            COALESCE(SUM(quantity_dispensed), 0) as total_dispensed
          FROM daily_dispensing_summary
          GROUP BY drug_id
        )
        SELECT
          dds.*,
          ai.name as drug_name,
          ai.batch_no,
          GREATEST(ai.approved_quantity - COALESCE(dt.total_dispensed, 0), 0) as current_stock,
          u.name as recorded_by_name
        FROM daily_dispensing_summary dds
        JOIN approved_inventory ai ON dds.drug_id = ai.id
        JOIN users u ON dds.recorded_by = u.id
        LEFT JOIN dispensed_total dt ON dds.drug_id = dt.drug_id
        WHERE dds.dispensing_date = CURRENT_DATE
        ORDER BY ai.name
      `, [userId]);
    } else {
      result = await db.query(`
        SELECT
          dds.*,
          d.name as drug_name,
          d.batch_no,
          d.stock as current_stock,
          u.name as recorded_by_name
        FROM daily_dispensing_summary dds
        JOIN drugs d ON dds.drug_id = d.id
        JOIN users u ON dds.recorded_by = u.id
        WHERE d.created_by = $1 AND dds.dispensing_date = CURRENT_DATE
        ORDER BY d.name
      `, [userId]);
    }

    const totalDispensed = result.rows.reduce((sum, record) => sum + parseInt(record.quantity_dispensed), 0);
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
  const userRole = req.user.role;

  const { start_date, end_date } = req.query;

  try {
    let result;

    if (userRole === 'pharmacy') {
      result = await db.query(`
        SELECT
          dds.dispensing_date,
          COUNT(dds.id) as drugs_dispensed,
          SUM(dds.quantity_dispensed) as total_quantity,
          dds.category
        FROM daily_dispensing_summary dds
        JOIN (
          SELECT d.id
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          JOIN drugs d ON oi.drug_id = d.id
          WHERE o.user_id = $1
            AND oi.status = 'approved'
            AND o.transaction_type = 'institute'
          GROUP BY d.id
        ) inv ON dds.drug_id = inv.id
        WHERE dds.dispensing_date BETWEEN $2 AND $3
        GROUP BY dds.dispensing_date, dds.category
        ORDER BY dds.dispensing_date DESC, dds.category
      `, [userId, start_date, end_date || start_date]);
    } else {
      result = await db.query(`
        SELECT
          dds.dispensing_date,
          COUNT(dds.id) as drugs_dispensed,
          SUM(dds.quantity_dispensed) as total_quantity,
          dds.category
        FROM daily_dispensing_summary dds
        JOIN drugs d ON dds.drug_id = d.id
        WHERE d.created_by = $1
          AND dds.dispensing_date BETWEEN $2 AND $3
        GROUP BY dds.dispensing_date, dds.category
        ORDER BY dds.dispensing_date DESC, dds.category
      `, [userId, start_date, end_date || start_date]);
    }

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
  const userRole = req.user.role;

  try {
    await db.query('BEGIN');

    // Get the record to delete
    let recordResult;
    if (userRole === 'pharmacy') {
      recordResult = await db.query(`
        SELECT dds.quantity_dispensed, dds.drug_id
        FROM daily_dispensing_summary dds
        WHERE dds.id = $1
        AND EXISTS (
          SELECT 1 
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          WHERE oi.drug_id = dds.drug_id
            AND o.user_id = $2
            AND oi.status = 'approved'
            AND o.transaction_type = 'institute'
        )
      `, [id, userId]);
    } else {
      recordResult = await db.query(`
        SELECT dds.quantity_dispensed, dds.drug_id
        FROM daily_dispensing_summary dds
        JOIN drugs d ON dds.drug_id = d.id
        WHERE dds.id = $1 AND d.created_by = $2
      `, [id, userId]);
    }

    if (recordResult.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({
        status: false,
        message: 'Record not found or not authorized'
      });
    }

    const record = recordResult.rows[0];

    // Only restore stock for institutes (pharmacy stock is calculated dynamically)
    if (userRole !== 'pharmacy') {
      await db.query(
        'UPDATE drugs SET stock = stock + $1, updated_at = NOW() WHERE id = $2',
        [record.quantity_dispensed, record.drug_id]
      );
    }

    await db.query('DELETE FROM daily_dispensing_summary WHERE id = $1', [id]);
    await db.query('COMMIT');

    res.json({
      status: true,
      message: 'Dispensing record deleted successfully'
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
