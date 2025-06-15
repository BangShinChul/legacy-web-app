const { db } = require('../config/database');
const { logActivity } = require('./auditService');
const { inventoryNotifications } = require('./notificationService');

/**
 * Update inventory quantity
 * @param {number} productId - Product ID
 * @param {number} quantityChange - Quantity change (positive or negative)
 * @param {string} operation - Operation type (reserve, release, sell, restock, adjust)
 * @param {number} userId - User ID performing the operation
 * @returns {Promise<object>} Update result
 */
function updateInventory(productId, quantityChange, operation = 'adjust', userId = null) {
  return new Promise((resolve, reject) => {
    // Get current inventory
    db.get(
      'SELECT i.*, p.name as product_name FROM inventory i LEFT JOIN products p ON i.product_id = p.id WHERE i.product_id = ?',
      [productId],
      (err, inventory) => {
        if (err) {
          return reject(new Error('Database error: ' + err.message));
        }

        if (!inventory) {
          return reject(new Error('Inventory record not found'));
        }

        let newQuantity = inventory.quantity;
        let newReservedQuantity = inventory.reserved_quantity;

        switch (operation) {
          case 'reserve':
            // Reserve stock (decrease available, increase reserved)
            const availableQuantity = inventory.quantity - inventory.reserved_quantity;
            if (availableQuantity < Math.abs(quantityChange)) {
              return reject(new Error('Insufficient available inventory'));
            }
            newReservedQuantity = inventory.reserved_quantity + Math.abs(quantityChange);
            break;

          case 'release':
            // Release reserved stock (decrease reserved)
            newReservedQuantity = Math.max(0, inventory.reserved_quantity - Math.abs(quantityChange));
            break;

          case 'sell':
            // Sell reserved stock (decrease both quantity and reserved)
            const reservedToSell = Math.min(inventory.reserved_quantity, Math.abs(quantityChange));
            const directSell = Math.abs(quantityChange) - reservedToSell;
            
            newQuantity = inventory.quantity - Math.abs(quantityChange);
            newReservedQuantity = inventory.reserved_quantity - reservedToSell;
            
            if (newQuantity < 0) {
              return reject(new Error('Insufficient inventory to sell'));
            }
            break;

          case 'restock':
            // Add new stock
            newQuantity = inventory.quantity + Math.abs(quantityChange);
            break;

          case 'adjust':
            // Direct quantity adjustment
            newQuantity = inventory.quantity + quantityChange;
            if (newQuantity < 0) {
              return reject(new Error('Adjustment would result in negative inventory'));
            }
            break;

          default:
            return reject(new Error('Invalid operation type'));
        }

        // Update inventory
        db.run(
          'UPDATE inventory SET quantity = ?, reserved_quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?',
          [newQuantity, newReservedQuantity, productId],
          function(err) {
            if (err) {
              return reject(new Error('Failed to update inventory: ' + err.message));
            }

            // Log the inventory change
            if (userId) {
              logActivity('inventory', inventory.id, 'UPDATE', inventory, {
                operation,
                quantityChange,
                newQuantity,
                newReservedQuantity
              }, userId);
            }

            // Check for low stock alerts
            if (newQuantity <= inventory.reorder_level && inventory.quantity > inventory.reorder_level) {
              inventoryNotifications.lowStock(inventory.product_name, newQuantity, inventory.reorder_level);
            }

            // Check for out of stock alerts
            if (newQuantity === 0 && inventory.quantity > 0) {
              inventoryNotifications.outOfStock(inventory.product_name);
            }

            // Check for restock alerts
            if (operation === 'restock' && inventory.quantity <= inventory.reorder_level) {
              inventoryNotifications.restocked(inventory.product_name, newQuantity);
            }

            resolve({
              success: true,
              productId,
              operation,
              quantityChange,
              previousQuantity: inventory.quantity,
              newQuantity,
              previousReserved: inventory.reserved_quantity,
              newReserved: newReservedQuantity,
              availableQuantity: newQuantity - newReservedQuantity
            });
          }
        );
      }
    );
  });
}

/**
 * Bulk inventory update
 * @param {Array} updates - Array of inventory updates
 * @param {string} operation - Operation type
 * @param {number} userId - User ID performing the operation
 * @returns {Promise<object>} Update result
 */
function bulkUpdateInventory(updates, operation = 'adjust', userId = null) {
  return new Promise((resolve, reject) => {
    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return reject(new Error('Updates array is required'));
    }

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      let processedCount = 0;
      let results = [];
      let hasError = false;

      updates.forEach((update, index) => {
        const { productId, quantityChange } = update;

        if (!productId || quantityChange === undefined) {
          hasError = true;
          db.run('ROLLBACK');
          return reject(new Error(`Invalid update data at index ${index}`));
        }

        updateInventory(productId, quantityChange, operation, userId)
          .then(result => {
            results.push(result);
            processedCount++;

            if (processedCount === updates.length && !hasError) {
              db.run('COMMIT', (err) => {
                if (err) {
                  return reject(new Error('Failed to commit bulk inventory update'));
                }

                resolve({
                  success: true,
                  processedCount,
                  results
                });
              });
            }
          })
          .catch(error => {
            hasError = true;
            db.run('ROLLBACK');
            reject(error);
          });
      });
    });
  });
}

/**
 * Check inventory availability
 * @param {number} productId - Product ID
 * @param {number} requestedQuantity - Requested quantity
 * @returns {Promise<object>} Availability check result
 */
function checkInventoryAvailability(productId, requestedQuantity) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT 
        i.*,
        p.name as product_name,
        p.is_active,
        (i.quantity - i.reserved_quantity) as available_quantity
       FROM inventory i 
       LEFT JOIN products p ON i.product_id = p.id 
       WHERE i.product_id = ?`,
      [productId],
      (err, inventory) => {
        if (err) {
          return reject(new Error('Database error: ' + err.message));
        }

        if (!inventory) {
          return resolve({
            available: false,
            reason: 'Product not found',
            productId,
            requestedQuantity
          });
        }

        if (!inventory.is_active) {
          return resolve({
            available: false,
            reason: 'Product is not active',
            productId,
            requestedQuantity
          });
        }

        const isAvailable = inventory.available_quantity >= requestedQuantity;

        resolve({
          available: isAvailable,
          reason: isAvailable ? null : 'Insufficient stock',
          productId,
          productName: inventory.product_name,
          requestedQuantity,
          availableQuantity: inventory.available_quantity,
          totalQuantity: inventory.quantity,
          reservedQuantity: inventory.reserved_quantity
        });
      }
    );
  });
}

/**
 * Bulk check inventory availability
 * @param {Array} items - Array of {productId, quantity}
 * @returns {Promise<object>} Bulk availability check result
 */
function bulkCheckInventoryAvailability(items) {
  return new Promise((resolve, reject) => {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return reject(new Error('Items array is required'));
    }

    const checks = items.map(item => 
      checkInventoryAvailability(item.productId, item.quantity)
    );

    Promise.all(checks)
      .then(results => {
        const unavailableItems = results.filter(result => !result.available);
        const allAvailable = unavailableItems.length === 0;

        resolve({
          allAvailable,
          results,
          unavailableItems,
          availableItems: results.filter(result => result.available)
        });
      })
      .catch(reject);
  });
}

/**
 * Get low stock items
 * @param {number} limit - Maximum number of items to return
 * @returns {Promise<Array>} Low stock items
 */
function getLowStockItems(limit = 50) {
  return new Promise((resolve, reject) => {
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
      LIMIT ?
    `;

    db.all(query, [limit], (err, items) => {
      if (err) {
        return reject(new Error('Database error: ' + err.message));
      }

      resolve(items);
    });
  });
}

/**
 * Get inventory movements/history
 * @param {number} productId - Product ID (optional)
 * @param {number} limit - Maximum number of records
 * @returns {Promise<Array>} Inventory movements
 */
function getInventoryMovements(productId = null, limit = 100) {
  return new Promise((resolve, reject) => {
    let query = `
      SELECT 
        al.*,
        p.name as product_name,
        p.sku,
        u.username,
        u.first_name,
        u.last_name
      FROM audit_logs al
      LEFT JOIN products p ON al.record_id = p.id
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.table_name = 'inventory'
    `;

    let queryParams = [];

    if (productId) {
      query += ' AND p.id = ?';
      queryParams.push(productId);
    }

    query += ' ORDER BY al.created_at DESC LIMIT ?';
    queryParams.push(limit);

    db.all(query, queryParams, (err, movements) => {
      if (err) {
        return reject(new Error('Database error: ' + err.message));
      }

      // Parse JSON values in audit logs
      movements.forEach(movement => {
        if (movement.old_values) {
          try {
            movement.old_values = JSON.parse(movement.old_values);
          } catch (e) {
            movement.old_values = null;
          }
        }
        if (movement.new_values) {
          try {
            movement.new_values = JSON.parse(movement.new_values);
          } catch (e) {
            movement.new_values = null;
          }
        }
      });

      resolve(movements);
    });
  });
}

/**
 * Calculate inventory value
 * @param {number} productId - Product ID (optional, calculates for all if not provided)
 * @returns {Promise<object>} Inventory value calculation
 */
function calculateInventoryValue(productId = null) {
  return new Promise((resolve, reject) => {
    let query = `
      SELECT 
        SUM(p.price * i.quantity) as total_value,
        SUM(p.cost_price * i.quantity) as total_cost,
        SUM(i.quantity) as total_quantity,
        COUNT(*) as product_count
      FROM inventory i
      LEFT JOIN products p ON i.product_id = p.id
      WHERE p.is_active = 1
    `;

    let queryParams = [];

    if (productId) {
      query += ' AND p.id = ?';
      queryParams.push(productId);
    }

    db.get(query, queryParams, (err, result) => {
      if (err) {
        return reject(new Error('Database error: ' + err.message));
      }

      const totalValue = result.total_value || 0;
      const totalCost = result.total_cost || 0;
      const totalQuantity = result.total_quantity || 0;
      const productCount = result.product_count || 0;

      resolve({
        totalValue,
        totalCost,
        totalQuantity,
        productCount,
        averageValue: productCount > 0 ? totalValue / productCount : 0,
        potentialProfit: totalValue - totalCost,
        profitMargin: totalValue > 0 ? ((totalValue - totalCost) / totalValue * 100).toFixed(2) : 0
      });
    });
  });
}

module.exports = {
  updateInventory,
  bulkUpdateInventory,
  checkInventoryAvailability,
  bulkCheckInventoryAvailability,
  getLowStockItems,
  getInventoryMovements,
  calculateInventoryValue
};
