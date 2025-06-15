const express = require('express');
const { db } = require('../config/database');
const { authenticateToken, requireAdmin, requireOwnershipOrAdmin } = require('../middleware/auth');
const { logActivity } = require('../services/auditService');
const { sendNotification } = require('../services/notificationService');
const { processPayment } = require('../services/paymentService');
const { updateInventory } = require('../services/inventoryService');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Get user's orders
router.get('/', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin';
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  const status = req.query.status;

  let whereClause = isAdmin ? 'WHERE 1=1' : 'WHERE o.user_id = ?';
  let queryParams = isAdmin ? [] : [userId];

  if (status) {
    whereClause += ' AND o.status = ?';
    queryParams.push(status);
  }

  const query = `
    SELECT 
      o.*,
      u.username,
      u.first_name,
      u.last_name,
      COUNT(oi.id) as item_count
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN order_items oi ON o.id = oi.order_id
    ${whereClause}
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `;

  queryParams.push(limit, offset);

  db.all(query, queryParams, (err, orders) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(DISTINCT o.id) as total
      FROM orders o
      ${whereClause}
    `;

    db.get(countQuery, queryParams.slice(0, -2), (err, countResult) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        orders,
        pagination: {
          page,
          limit,
          total: countResult.total,
          pages: Math.ceil(countResult.total / limit)
        }
      });
    });
  });
});

// Get single order with items
router.get('/:id', authenticateToken, (req, res) => {
  const orderId = req.params.id;
  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin';

  const orderQuery = `
    SELECT 
      o.*,
      u.username,
      u.first_name,
      u.last_name,
      u.email
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    WHERE o.id = ? ${!isAdmin ? 'AND o.user_id = ?' : ''}
  `;

  const orderParams = isAdmin ? [orderId] : [orderId, userId];

  db.get(orderQuery, orderParams, (err, order) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Get order items
    const itemsQuery = `
      SELECT 
        oi.*,
        p.name as product_name,
        p.sku,
        (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as product_image
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `;

    db.all(itemsQuery, [orderId], (err, items) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      order.items = items;
      res.json({ order });
    });
  });
});

// Create new order
router.post('/', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const {
    items, // Array of {productId, quantity}
    shippingAddress,
    billingAddress,
    paymentMethod,
    notes
  } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Order items are required' });
  }

  if (!shippingAddress || !billingAddress) {
    return res.status(400).json({ error: 'Shipping and billing addresses are required' });
  }

  try {
    // Start transaction
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      // Generate order number
      const orderNumber = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();

      // Calculate totals
      let totalAmount = 0;
      let orderItems = [];

      // Validate items and calculate total
      let itemsProcessed = 0;
      let hasError = false;

      items.forEach((item, index) => {
        db.get(
          `SELECT p.*, i.quantity as stock_quantity 
           FROM products p 
           LEFT JOIN inventory i ON p.id = i.product_id 
           WHERE p.id = ? AND p.is_active = 1`,
          [item.productId],
          (err, product) => {
            if (err || !product) {
              hasError = true;
              db.run('ROLLBACK');
              return res.status(400).json({ error: `Product ${item.productId} not found` });
            }

            if (product.stock_quantity < item.quantity) {
              hasError = true;
              db.run('ROLLBACK');
              return res.status(400).json({ 
                error: `Insufficient stock for product ${product.name}. Available: ${product.stock_quantity}, Requested: ${item.quantity}` 
              });
            }

            const itemTotal = product.price * item.quantity;
            totalAmount += itemTotal;

            orderItems.push({
              productId: product.id,
              quantity: item.quantity,
              unitPrice: product.price,
              totalPrice: itemTotal
            });

            itemsProcessed++;

            // If all items processed, create the order
            if (itemsProcessed === items.length && !hasError) {
              createOrder();
            }
          }
        );
      });

      function createOrder() {
        // Insert order
        db.run(
          `INSERT INTO orders (
            user_id, order_number, status, total_amount, 
            shipping_address, billing_address, payment_method, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId, orderNumber, 'pending', totalAmount,
            JSON.stringify(shippingAddress), JSON.stringify(billingAddress),
            paymentMethod, notes
          ],
          function(err) {
            if (err) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Failed to create order' });
            }

            const orderId = this.lastID;

            // Insert order items
            let itemsInserted = 0;
            orderItems.forEach(item => {
              db.run(
                'INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?)',
                [orderId, item.productId, item.quantity, item.unitPrice, item.totalPrice],
                (err) => {
                  if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Failed to create order items' });
                  }

                  itemsInserted++;

                  if (itemsInserted === orderItems.length) {
                    // Update inventory (reserve stock)
                    orderItems.forEach(item => {
                      updateInventory(item.productId, -item.quantity, 'reserve');
                    });

                    // Commit transaction
                    db.run('COMMIT', (err) => {
                      if (err) {
                        return res.status(500).json({ error: 'Failed to commit order' });
                      }

                      // Log activity
                      logActivity('orders', orderId, 'INSERT', null, {
                        orderNumber, totalAmount, itemCount: orderItems.length
                      }, userId);

                      // Send notification
                      sendNotification(userId, 'order_created', 'Order Created', 
                        `Your order ${orderNumber} has been created successfully.`);

                      res.status(201).json({
                        message: 'Order created successfully',
                        orderId,
                        orderNumber,
                        totalAmount
                      });
                    });
                  }
                }
              );
            });
          }
        );
      }
    });
  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update order status (Admin only)
router.put('/:id/status', authenticateToken, requireAdmin, (req, res) => {
  const orderId = req.params.id;
  const { status, notes } = req.body;

  const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  // Get current order
  db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Update order
    const updateFields = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const updateValues = [status];

    if (notes) {
      updateFields.push('notes = ?');
      updateValues.push(notes);
    }

    updateValues.push(orderId);

    db.run(
      `UPDATE orders SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues,
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to update order status' });
        }

        // Handle inventory changes based on status
        if (status === 'cancelled' && order.status !== 'cancelled') {
          // Release reserved inventory
          db.all(
            'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
            [orderId],
            (err, items) => {
              if (!err && items) {
                items.forEach(item => {
                  updateInventory(item.product_id, item.quantity, 'release');
                });
              }
            }
          );
        } else if (status === 'confirmed' && order.status === 'pending') {
          // Convert reserved to sold
          db.all(
            'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
            [orderId],
            (err, items) => {
              if (!err && items) {
                items.forEach(item => {
                  updateInventory(item.product_id, -item.quantity, 'sell');
                });
              }
            }
          );
        }

        // Log activity
        logActivity('orders', orderId, 'UPDATE', order, { status, notes }, req.user.id);

        // Send notification to customer
        sendNotification(order.user_id, 'order_status_updated', 'Order Status Updated', 
          `Your order ${order.order_number} status has been updated to: ${status}`);

        res.json({ message: 'Order status updated successfully' });
      }
    );
  });
});

// Cancel order (Customer can cancel pending orders)
router.put('/:id/cancel', authenticateToken, (req, res) => {
  const orderId = req.params.id;
  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin';

  const whereClause = isAdmin ? 'WHERE id = ?' : 'WHERE id = ? AND user_id = ?';
  const queryParams = isAdmin ? [orderId] : [orderId, userId];

  db.get(`SELECT * FROM orders ${whereClause}`, queryParams, (err, order) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending orders can be cancelled' });
    }

    // Update order status
    db.run(
      'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['cancelled', orderId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to cancel order' });
        }

        // Release reserved inventory
        db.all(
          'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
          [orderId],
          (err, items) => {
            if (!err && items) {
              items.forEach(item => {
                updateInventory(item.product_id, item.quantity, 'release');
              });
            }
          }
        );

        // Log activity
        logActivity('orders', orderId, 'UPDATE', order, { status: 'cancelled' }, userId);

        res.json({ message: 'Order cancelled successfully' });
      }
    );
  });
});

// Get order statistics (Admin only)
router.get('/stats/summary', authenticateToken, requireAdmin, (req, res) => {
  const queries = [
    'SELECT COUNT(*) as total_orders FROM orders',
    'SELECT COUNT(*) as pending_orders FROM orders WHERE status = "pending"',
    'SELECT COUNT(*) as confirmed_orders FROM orders WHERE status = "confirmed"',
    'SELECT COUNT(*) as shipped_orders FROM orders WHERE status = "shipped"',
    'SELECT SUM(total_amount) as total_revenue FROM orders WHERE status != "cancelled"',
    'SELECT AVG(total_amount) as average_order_value FROM orders WHERE status != "cancelled"'
  ];

  const stats = {};
  let queriesCompleted = 0;

  queries.forEach((query, index) => {
    db.get(query, [], (err, result) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const key = Object.keys(result)[0];
      stats[key] = result[key] || 0;
      queriesCompleted++;

      if (queriesCompleted === queries.length) {
        res.json({ stats });
      }
    });
  });
});

module.exports = router;
