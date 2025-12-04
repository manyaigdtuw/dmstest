// routes/sellerRoutes.js
const express = require('express');
const router = express.Router();
const {
  listSellerOrders,
  updateOrderItemStatus,
  approveAllItems // Add this import
} = require('../controllers/sellerController');
const verifyToken = require('../middlewares/authMiddleware');
const authorizeRole = require('../middlewares/roleMiddleware');

// List orders for seller
router.get(
  '/orders', 
  verifyToken, 
  authorizeRole('institute', 'admin'), 
  listSellerOrders
);

// Update order item status
router.patch(
  '/order-items/:orderItemId/status', 
  verifyToken, 
  authorizeRole('institute', 'admin'), 
  updateOrderItemStatus
);

// Approve all items in an order
router.patch(
  '/orders/:orderId/approve-all', 
  verifyToken, 
  authorizeRole('institute', 'admin'), 
  approveAllItems
);

module.exports = router;