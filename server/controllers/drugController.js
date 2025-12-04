const addDrug = async (req, res) => {
  try {
    const {
      drug_type,
      name,
      description,
      stock,
      mfg_date,
      exp_date,
      price,
      batch_no,
      category,
    } = req.body;
    const created_by = req.user.id;

    // Validate only name is required
    if (!name) {
      return res.status(400).json({ error: 'Drug name is required' });
    }

    // Validate manufacturing date is before expiration date (only if both are provided)
    if (mfg_date && exp_date && new Date(mfg_date) >= new Date(exp_date)) {
      return res
        .status(400)
        .json({ error: 'Manufacturing date must be before expiration date' });
    }

    const query = `
            INSERT INTO drugs (drug_type, name, description, stock, mfg_date, exp_date, price, created_by, batch_no, category, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
            RETURNING *`;

    const values = [
      drug_type || null,           // Optional
      name,                        // Required
      description || null,         // Optional
      stock || 0,                  // Default to 0
      mfg_date || null,            // Optional
      exp_date || null,            // Optional
      price || 0,                  // Default to 0
      created_by,
      batch_no || null,            // Optional
      category || null,            // Optional
    ];

    const result = await req.app.locals.db.query(query, values);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding drug:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getDrugs = async (req, res) => {
  try {
    let query, values;

    const { created_by } = req.query;

    if (created_by) {
      // Filter drugs by creator (institute) - sorted by mfg_date (oldest first)
      query = `
        SELECT d.*, u.name as creator_name 
        FROM drugs d
        JOIN users u ON d.created_by = u.id
        WHERE d.created_by = $1 
        ORDER BY d.updated_at DESC, d.mfg_date ASC, d.name`;
      values = [created_by];
    } else if (req.user.role === 'institute' || req.user.role === 'pharmacy') {
      // Get drugs for the current user - sorted by last updated (newest first)
      query = `
        SELECT d.*, u.name as creator_name 
        FROM drugs d
        JOIN users u ON d.created_by = u.id
        WHERE d.created_by = $1 
        ORDER BY d.updated_at DESC, d.mfg_date ASC, d.name`;
      values = [req.user.id];
    } else {
      // Admin can see all drugs with creator names - sorted by last updated (newest first)
      query = `
        SELECT d.*, u.name as creator_name 
        FROM drugs d
        JOIN users u ON d.created_by = u.id
        ORDER BY d.updated_at DESC, d.mfg_date ASC, d.name`;
      values = [];
    }

    const result = await req.app.locals.db.query(query, values);
    res.json({
      status: true,
      drugs: result.rows,
    });
  } catch (error) {
    console.error('Error fetching drugs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getDrugById = async (req, res) => {
  try {
    const { id } = req.params;
    let query, values;

    if (req.user.role === 'institute' || req.user.role === 'pharmacy') {
      query = `
        SELECT d.*, u.name as creator_name 
        FROM drugs d
        JOIN users u ON d.created_by = u.id
        WHERE d.id = $1 AND d.created_by = $2`;
      values = [id, req.user.id];
    } else {
      query = `
        SELECT d.*, u.name as creator_name 
        FROM drugs d
        JOIN users u ON d.created_by = u.id
        WHERE d.id = $1`;
      values = [id];
    }

    const result = await req.app.locals.db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Drug not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching drug:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateDrug = async (req, res) => {
  try {
    const { id } = req.params;
    const { drug_type, name, description, stock, price, batch_no, category } =
      req.body;

    // Validate only name is required
    if (!name) {
      return res.status(400).json({ error: 'Drug name is required' });
    }

    let query, values;

    if (req.user.role === 'institute' || req.user.role === 'pharmacy') {
      query = `
        UPDATE drugs 
        SET drug_type = $1,
            name = $2, 
            description = $3, 
            stock = $4, 
            price = $5,
            batch_no = $6,
            category = $7,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $8 AND created_by = $9
        RETURNING *`;
      values = [
        drug_type || null,
        name,
        description || null,
        stock || 0,
        price || 0,
        batch_no || null,
        category || null,
        id,
        req.user.id,
      ];
    } else {
      // Admin can update any drug
      query = `
        UPDATE drugs 
        SET drug_type = $1,
            name = $2, 
            description = $3, 
            stock = $4, 
            price = $5,
            batch_no = $6,
            category = $7,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $8
        RETURNING *`;
      values = [
        drug_type || null,
        name,
        description || null,
        stock || 0,
        price || 0,
        batch_no || null,
        category || null,
        id,
      ];
    }

    const result = await req.app.locals.db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Drug not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating drug:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteDrug = async (req, res) => {
  try {
    const { id } = req.params;
    let query, values;

    if (req.user.role === 'institute' || req.user.role === 'pharmacy') {
      // Institute and Pharmacy can only delete drugs they created
      query = 'DELETE FROM drugs WHERE id = $1 AND created_by = $2 RETURNING *';
      values = [id, req.user.id];
    } else {
      // Admin can delete any drug
      query = 'DELETE FROM drugs WHERE id = $1 RETURNING *';
      values = [id];
    }

    const result = await req.app.locals.db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Drug not found' });
    }

    res.json({
      message: 'Drug deleted successfully',
      deletedDrug: result.rows[0],
    });
  } catch (error) {
    console.error('Error deleting drug:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getExpiringDrugs = async (req, res) => {
  const db = req.app.locals.db;

  try {
    // Validate inputs
    const daysThreshold = parseInt(req.query.days) || 30;
    if (isNaN(daysThreshold)) {
      return res
        .status(400)
        .json({ status: false, message: 'Invalid days parameter' });
    }

    const limit = parseInt(req.query.limit) || 10;
    if (isNaN(limit) || limit <= 0) {
      return res
        .status(400)
        .json({ status: false, message: 'Invalid limit parameter' });
    }

    const page = parseInt(req.query.page) || 1;
    if (isNaN(page) || page <= 0) {
      return res
        .status(400)
        .json({ status: false, message: 'Invalid page parameter' });
    }

    const offset = (page - 1) * limit;

    let queryText = `
      SELECT id, drug_type, name, description, stock, price, 
             mfg_date, exp_date, batch_no, updated_at,
             (exp_date - CURRENT_DATE) AS days_until_expiry
      FROM drugs
      WHERE exp_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + ($1 || ' days')::interval)
      AND stock > 0
    `;

    let countText = `SELECT COUNT(*) FROM drugs 
                    WHERE exp_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + ($1 || ' days')::interval)
                    AND stock > 0`;

    let queryParams = [daysThreshold];
    let countParams = [daysThreshold];

    if (req.user.role !== 'admin') {
      queryText += ' AND created_by = $2';
      countText += ' AND created_by = $2';
      queryParams.push(req.user.id);
      countParams.push(req.user.id);
    }

    queryText += ` ORDER BY exp_date ASC LIMIT $${
      queryParams.length + 1
    } OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);

    const result = await db.query(queryText, queryParams);
    const countResult = await db.query(countText, countParams);

    res.json({
      status: true,
      drugs: result.rows,
      total: parseInt(countResult.rows[0].count),
      page,
      limit,
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit),
      daysThreshold,
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ status: false, message: error.message });
  }
};

module.exports = {
  addDrug,
  getDrugs,
  getDrugById,
  updateDrug,
  deleteDrug,
  getExpiringDrugs,
};