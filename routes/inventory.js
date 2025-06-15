const express = require('express');
const { db } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../services/auditService');
const { sendNotification } = require('../services/notificationService');

const router = express.Router();

// Get inventory overview (Admin only)
router.get('/', authenticateToken, requireAdmin, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const lowStock = req.query.lowStock === 'true';
  const search = req.query.search;

  let whereClause = 'WHERE p.is_active = 1';
  let queryParams = [];

  if (lowStock) {
    whereClause += ' AND i.quantity <= i.reorder_level';
  }

  if (search) {
    whereClause += ' AND (p.name LIKE ? OR p.sku LIKE ?)';
    queryParams.push(`%${search}%`, `%${search}%`);
  }

  const query = `
    SELECT 
      i.*,
      p.name as product_name,
      p.sku,
      p.price,
      c.name as category_name,
      (i.quantity - i.reserved_quantity) as available_quantity
    FROM inventory i
    LEFT JOIN products p ON i.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    ${whereClause}
    ORDER BY i.last_updated DESC
    LIMIT ? OFFSET ?
  `;

  queryParams.push(limit, offset);

  db.all(query, queryParams, (err, inventory) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM inventory i
      LEFT JOIN products p ON i.product_id = p.id
      ${whereClause}
    `;

    db.get(countQuery, queryParams.slice(0, -2), (err, countResult) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        inventory,
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

// Get inventory for specific product
router.get('/product/:productId', authenticateToken, requireAdmin, (req, res) => {
  const productId = req.params.productId;

  const query = `
    SELECT 
      i.*,
      p.name as product_name,
      p.sku,
      p.price,
      c.name as category_name,
      (i.quantity - i.reserved_quantity) as available_quantity
    FROM inventory i
    LEFT JOIN products p ON i.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE i.product_id = ?
  `;

  db.get(query, [productId], (err, inventory) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!inventory) {
      return res.status(404).json({ error: 'Inventory record not found' });
    }

    res.json({ inventory });
  });
});

// Update inventory quantity (Admin only)
router.put('/product/:productId', authenticateToken, requireAdmin, (req, res) => {
  const productId = req.params.productId;
  const { quantity, reorderLevel, warehouseLocation, adjustmentReason } = req.body;

  // Get current inventory
  db.get('SELECT * FROM inventory WHERE product_id = ?', [productId], (err, currentInventory) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!currentInventory) {
      return res.status(404).json({ error: 'Inventory record not found' });
    }

    const updateFields = [];
    const updateValues = [];

    if (quantity !== undefined) {
      updateFields.push('quantity = ?');
      updateValues.push(quantity);
    }
    if (reorderLevel !== undefined) {
      updateFields.push('reorder_level = ?');
      updateValues.push(reorderLevel);
    }
    if (warehouseLocation !== undefined) {
      updateFields.push('warehouse_location = ?');
      updateValues.push(warehouseLocation);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateFields.push('last_updated = CURRENT_TIMESTAMP');
    updateValues.push(productId);

    const updateQuery = `UPDATE inventory SET ${updateFields.join(', ')} WHERE product_id = ?`;

    db.run(updateQuery, updateValues, function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to update inventory' });
      }

      // Log inventory adjustment
      logActivity('inventory', currentInventory.id, 'UPDATE', currentInventory, {
        quantity, reorderLevel, warehouseLocation, adjustmentReason
      }, req.user.id);

      // Check if stock is low and send notification
      if (quantity !== undefined && quantity <= (reorderLevel || currentInventory.reorder_level)) {
        // Get product name for notification
        db.get('SELECT name FROM products WHERE id = ?', [productId], (err, product) => {
          if (!err && product) {
            sendNotification(
              null, // System notification (no specific user)
              'low_stock_alert',
              'Low Stock Alert',
              `Product "${product.name}" is running low on stock. Current quantity: ${quantity}`,
              { productId, quantity, reorderLevel: reorderLevel || currentInventory.reorder_level }
            );
          }
        });
      }

      res.json({ message: 'Inventory updated successfully' });
    });
  });
});

// Bulk inventory adjustment (Admin only)
router.post('/bulk-adjustment', authenticateToken, requireAdmin, (req, res) => {
  const { adjustments, reason } = req.body; // adjustments: [{productId, quantityChange, newReorderLevel}]

  if (!adjustments || !Array.isArray(adjustments) || adjustments.length === 0) {
    return res.status(400).json({ error: 'Adjustments array is required' });
  }

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    let processedCount = 0;
    let hasError = false;

    adjustments.forEach((adjustment, index) => {
      const { productId, quantityChange, newReorderLevel } = adjustment;

      if (!productId || quantityChange === undefined) {
        hasError = true;
        db.run('ROLLBACK');
        return res.status(400).json({ error: `Invalid adjustment data at index ${index}` });
      }

      // Get current inventory
      db.get('SELECT * FROM inventory WHERE product_id = ?', [productId], (err, currentInventory) => {
        if (err || !currentInventory) {
          hasError = true;
          db.run('ROLLBACK');
          return res.status(400).json({ error: `Inventory not found for product ${productId}` });
        }

        const newQuantity = currentInventory.quantity + quantityChange;
        if (newQuantity < 0) {
          hasError = true;
          db.run('ROLLBACK');
          return res.status(400).json({ error: `Adjustment would result in negative inventory for product ${productId}` });
        }

        const updateFields = ['quantity = ?', 'last_updated = CURRENT_TIMESTAMP'];
        const updateValues = [newQuantity];

        if (newReorderLevel !== undefined) {
          updateFields.push('reorder_level = ?');
          updateValues.push(newReorderLevel);
        }

        updateValues.push(productId);

        db.run(
          `UPDATE inventory SET ${updateFields.join(', ')} WHERE product_id = ?`,
          updateValues,
          function(err) {
            if (err) {
              hasError = true;
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Failed to update inventory' });
            }

            // Log adjustment
            logActivity('inventory', currentInventory.id, 'UPDATE', currentInventory, {
              quantityChange, newQuantity, newReorderLevel, reason
            }, req.user.id);

            processedCount++;

            if (processedCount === adjustments.length && !hasError) {
              db.run('COMMIT', (err) => {
                if (err) {
                  return res.status(500).json({ error: 'Failed to commit bulk adjustment' });
                }

                res.json({
                  message: 'Bulk inventory adjustment completed successfully',
                  processedCount
                });
              });
            }
          }
        );
      });
    });
  });
});

// Get low stock alerts (Admin only)
router.get('/alerts/low-stock', authenticateToken, requireAdmin, (req, res) => {
  const query = `
    SELECT 
      i.*,
      p.name as product_name,
      p.sku,
      p.price,
      c.name as category_name,
      (i.quantity - i.reserved_quantity) as available_quantity
    FROM inventory i
    LEFT JOIN products p ON i.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.is_active = 1 AND i.quantity <= i.reorder_level
    ORDER BY (i.quantity - i.reorder_level) ASC
  `;

  db.all(query, [], (err, lowStockItems) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({
      lowStockItems,
      count: lowStockItems.length
    });
  });
});

// Get inventory statistics (Admin only)
router.get('/stats/summary', authenticateToken, requireAdmin, (req, res) => {
  const queries = [
    'SELECT COUNT(*) as total_products FROM inventory i LEFT JOIN products p ON i.product_id = p.id WHERE p.is_active = 1',
    'SELECT SUM(i.quantity) as total_stock FROM inventory i LEFT JOIN products p ON i.product_id = p.id WHERE p.is_active = 1',
    'SELECT SUM(i.reserved_quantity) as total_reserved FROM inventory i LEFT JOIN products p ON i.product_id = p.id WHERE p.is_active = 1',
    'SELECT COUNT(*) as low_stock_count FROM inventory i LEFT JOIN products p ON i.product_id = p.id WHERE p.is_active = 1 AND i.quantity <= i.reorder_level',
    'SELECT COUNT(*) as out_of_stock_count FROM inventory i LEFT JOIN products p ON i.product_id = p.id WHERE p.is_active = 1 AND i.quantity = 0',
    'SELECT SUM(p.price * i.quantity) as total_inventory_value FROM inventory i LEFT JOIN products p ON i.product_id = p.id WHERE p.is_active = 1'
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
        // Calculate additional metrics
        stats.available_stock = stats.total_stock - stats.total_reserved;
        stats.stock_utilization = stats.total_stock > 0 ? 
          ((stats.total_stock - stats.total_reserved) / stats.total_stock * 100).toFixed(2) : 0;

        res.json({ stats });
      }
    });
  });
});

// Reserve inventory (used by order system)
router.post('/reserve', authenticateToken, (req, res) => {
  const { items } = req.body; // [{productId, quantity}]

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items array is required' });
  }

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    let processedCount = 0;
    let hasError = false;

    items.forEach((item, index) => {
      const { productId, quantity } = item;

      if (!productId || !quantity || quantity <= 0) {
        hasError = true;
        db.run('ROLLBACK');
        return res.status(400).json({ error: `Invalid item data at index ${index}` });
      }

      db.get(
        'SELECT * FROM inventory WHERE product_id = ?',
        [productId],
        (err, inventory) => {
          if (err || !inventory) {
            hasError = true;
            db.run('ROLLBACK');
            return res.status(400).json({ error: `Inventory not found for product ${productId}` });
          }

          const availableQuantity = inventory.quantity - inventory.reserved_quantity;
          if (availableQuantity < quantity) {
            hasError = true;
            db.run('ROLLBACK');
            return res.status(400).json({ 
              error: `Insufficient available inventory for product ${productId}. Available: ${availableQuantity}, Requested: ${quantity}` 
            });
          }

          const newReservedQuantity = inventory.reserved_quantity + quantity;

          db.run(
            'UPDATE inventory SET reserved_quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?',
            [newReservedQuantity, productId],
            function(err) {
              if (err) {
                hasError = true;
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'Failed to reserve inventory' });
              }

              processedCount++;

              if (processedCount === items.length && !hasError) {
                db.run('COMMIT', (err) => {
                  if (err) {
                    return res.status(500).json({ error: 'Failed to commit inventory reservation' });
                  }

                  res.json({
                    message: 'Inventory reserved successfully',
                    reservedItems: items
                  });
                });
              }
            }
          );
        }
      );
    });
  });
});

// Release reserved inventory
router.post('/release', authenticateToken, (req, res) => {
  const { items } = req.body; // [{productId, quantity}]

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items array is required' });
  }

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    let processedCount = 0;
    let hasError = false;

    items.forEach((item, index) => {
      const { productId, quantity } = item;

      if (!productId || !quantity || quantity <= 0) {
        hasError = true;
        db.run('ROLLBACK');
        return res.status(400).json({ error: `Invalid item data at index ${index}` });
      }

      db.get(
        'SELECT * FROM inventory WHERE product_id = ?',
        [productId],
        (err, inventory) => {
          if (err || !inventory) {
            hasError = true;
            db.run('ROLLBACK');
            return res.status(400).json({ error: `Inventory not found for product ${productId}` });
          }

          const newReservedQuantity = Math.max(0, inventory.reserved_quantity - quantity);

          db.run(
            'UPDATE inventory SET reserved_quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?',
            [newReservedQuantity, productId],
            function(err) {
              if (err) {
                hasError = true;
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'Failed to release inventory' });
              }

              processedCount++;

              if (processedCount === items.length && !hasError) {
                db.run('COMMIT', (err) => {
                  if (err) {
                    return res.status(500).json({ error: 'Failed to commit inventory release' });
                  }

                  res.json({
                    message: 'Inventory released successfully',
                    releasedItems: items
                  });
                });
              }
            }
          );
        }
      );
    });
  });
});

module.exports = router;
