const listSellerOrders = async (req, res) => {
  const db = req.app.locals.db;
  const sellerId = req.user.id;
  const { status, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;

  try {
    // Fetch all orders visible to the seller (either seller or recipient)
    let orderQuery = `
      SELECT DISTINCT
        o.id AS order_id,
        o.order_no,
        o.created_at AS order_date,
        o.total_amount,
        u.name AS buyer_name,
        o.transaction_type,
        COUNT(oi.id) AS item_count,
        SUM(CASE WHEN oi.status = 'pending' THEN 1 ELSE 0 END) AS pending_items,
        SUM(CASE WHEN oi.status = 'approved' THEN 1 ELSE 0 END) AS approved_items,
        SUM(CASE WHEN oi.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_items,
        SUM(CASE WHEN oi.status = 'shipped' THEN 1 ELSE 0 END) AS shipped_items
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN users u ON o.user_id = u.id
      WHERE (oi.seller_id = $1 OR o.recipient_id = $1)
        AND o.transaction_type = 'institute'
    `;

    const params = [sellerId];
    let paramIndex = 2;

    if (status) {
      orderQuery += ` AND oi.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    orderQuery += `
      GROUP BY o.id, u.name, o.transaction_type
      ORDER BY o.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const ordersResult = await db.query(orderQuery, params);

    // Fetch order items for each order
    const ordersWithItems = await Promise.all(
      ordersResult.rows.map(async (order) => {
        const itemsQuery = `
          SELECT 
            oi.id,
            oi.drug_id,
            d.drug_type,
            d.name AS drug_name,
            d.batch_no,
            oi.quantity,
            oi.unit_price,
            oi.status,
            oi.category,
            (oi.quantity * oi.unit_price) AS total_price,
            u.name AS seller_name,
            COALESCE(d.stock, 0) AS available_stock
          FROM order_items oi
          JOIN users u ON oi.seller_id = u.id
          LEFT JOIN drugs d ON oi.drug_id = d.id
          WHERE oi.order_id = $1
          ORDER BY oi.created_at;
        `;

        const itemsResult = await db.query(itemsQuery, [order.order_id]);
        
        // Debug log - remove after fixing
        console.log(`Items for order ${order.order_id}:`, itemsResult.rows.map(item => ({
          id: item.id,
          drug_id: item.drug_id,
          drug_name: item.drug_name,
          available_stock: item.available_stock,
          quantity: item.quantity
        })));

        return {
          ...order,
          items: itemsResult.rows,
        };
      })
    );

    // Total count
    let countQuery = `
      SELECT COUNT(DISTINCT o.id)
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      WHERE (oi.seller_id = $1 OR o.recipient_id = $1)
        AND o.transaction_type = 'institute'
    `;
    const countParams = [sellerId];

    if (status) {
      countQuery += ` AND oi.status = $2`;
      countParams.push(status);
    }

    const countResult = await db.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      status: true,
      orders: ordersWithItems,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("Database error in listSellerOrders:", err);
    res.status(500).json({
      status: false,
      message: "Server error while fetching seller orders",
      error: err.message,
    });
  }
};

// -------------------------------------------
// UPDATE ORDER ITEM STATUS
// -------------------------------------------
const updateOrderItemStatus = async (req, res) => {
  const db = req.app.locals.db;
  const { orderItemId } = req.params;
  const { status, quantity } = req.body;
  const sellerId = req.user.id;

  try {
    // Verify ownership
    const itemResult = await db.query(
      `
      SELECT 
        oi.id,
        oi.status AS current_status,
        oi.drug_id,
        oi.quantity AS original_quantity,
        d.stock
      FROM order_items oi
      LEFT JOIN drugs d ON oi.drug_id = d.id
      WHERE oi.id = $1 AND oi.seller_id = $2
      `,
      [orderItemId, sellerId]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Order item not found or unauthorized",
      });
    }

    const item = itemResult.rows[0];
    
    // Debug log
    console.log("Item being updated:", {
      id: item.id,
      drug_id: item.drug_id,
      current_stock: item.stock,
      current_status: item.current_status,
      new_status: status,
      quantity: quantity || item.original_quantity
    });
    
    const newQuantity = quantity ? parseInt(quantity) : item.original_quantity;

    await db.query("BEGIN");

    // Quantity update
    if (quantity) {
      await db.query(
        `UPDATE order_items SET quantity = $1, updated_at = NOW() WHERE id = $2`,
        [newQuantity, orderItemId]
      );
    }

    // Status update
    if (status) {
      await db.query(
        `UPDATE order_items SET status = $1, updated_at = NOW() WHERE id = $2`,
        [status, orderItemId]
      );

      // Stock adjustment
      if (item.drug_id) {
        if (status === "approved" && item.current_status !== "approved") {
          // Check if enough stock
          if (item.stock < newQuantity) {
            await db.query("ROLLBACK");
            return res.status(400).json({
              status: false,
              message: `Insufficient stock. Available: ${item.stock}, Requested: ${newQuantity}`,
            });
          }
          
          await db.query(
            `UPDATE drugs SET stock = stock - $1 WHERE id = $2`,
            [newQuantity, item.drug_id]
          );
        } else if (status === "rejected" && item.current_status === "approved") {
          await db.query(
            `UPDATE drugs SET stock = stock + $1 WHERE id = $2`,
            [item.original_quantity, item.drug_id]
          );
        }
      }
    }

    await db.query("COMMIT");

    res.json({
      status: true,
      message: "Order item updated successfully",
    });
  } catch (err) {
    await db.query("ROLLBACK");
    console.error("Database error in updateOrderItemStatus:", err);
    res.status(500).json({
      status: false,
      message: "Server error while updating order item",
      error: err.message,
    });
  }
};

const approveAllItems = async (req, res) => {
  const db = req.app.locals.db;
  const { orderId } = req.params;
  const sellerId = req.user.id;

  try {
    await db.query("BEGIN");

    // Get pending items - ensure drugs exist and have stock
    const pendingItems = await db.query(
      `
      SELECT 
        oi.id,
        oi.drug_id,
        oi.quantity,
        d.stock,
        d.name AS drug_name
      FROM order_items oi
      INNER JOIN drugs d ON oi.drug_id = d.id
      WHERE oi.order_id = $1
        AND oi.status = 'pending'
        AND (oi.seller_id = $2 OR $2 = (SELECT recipient_id FROM orders WHERE id = $1))
      FOR UPDATE
      `,
      [orderId, sellerId]
    );

    // Debug log
    console.log("Pending items for bulk approval:", pendingItems.rows.map(item => ({
      id: item.id,
      drug_id: item.drug_id,
      drug_name: item.drug_name,
      stock: item.stock,
      quantity: item.quantity,
      sufficient: item.stock >= item.quantity
    })));

    if (pendingItems.rows.length === 0) {
      await db.query("ROLLBACK");
      return res.json({
        status: true,
        message: "No pending items found for this order",
        approvedCount: 0,
        insufficientStockItems: []
      });
    }

    let approvedCount = 0;
    const insufficientStockItems = [];

    for (const item of pendingItems.rows) {
      const availableStock = Number(item.stock) || 0;
      const requestedQuantity = Number(item.quantity);

      if (availableStock >= requestedQuantity) {
        try {
          // Approve the item
          await db.query(
            `UPDATE order_items SET status = 'approved', updated_at = NOW() WHERE id = $1`,
            [item.id]
          );

          // Deduct stock
          await db.query(
            `UPDATE drugs SET stock = stock - $1, updated_at = NOW() WHERE id = $2`,
            [requestedQuantity, item.drug_id]
          );

          approvedCount++;
        } catch (error) {
          console.error(`Error approving item ${item.id}:`, error);
          insufficientStockItems.push({
            drug_name: item.drug_name,
            requested: requestedQuantity,
            available: availableStock,
            reason: "Database error during approval"
          });
        }
      } else {
        insufficientStockItems.push({
          drug_name: item.drug_name,
          requested: requestedQuantity,
          available: availableStock,
          reason: "Insufficient stock"
        });
      }
    }

    await db.query("COMMIT");

    res.json({
      status: true,
      message: `Approved ${approvedCount} items${insufficientStockItems.length > 0 ? `, ${insufficientStockItems.length} items had insufficient stock` : ''}`,
      approvedCount,
      insufficientStockItems,
      totalItems: pendingItems.rows.length
    });
  } catch (err) {
    await db.query("ROLLBACK");
    console.error("approveAllItems error:", err);
    res.status(500).json({
      status: false,
      message: "Server error while approving items",
      error: err.message,
    });
  }
};

module.exports = {
  listSellerOrders,
  updateOrderItemStatus,
  approveAllItems,
};