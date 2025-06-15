const { db } = require('../config/database');

/**
 * Send notification to user(s)
 * @param {number|null} userId - User ID (null for system notifications)
 * @param {string} type - Notification type
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {object} metadata - Additional metadata
 */
function sendNotification(userId, type, title, message, metadata = null) {
  const metadataJson = metadata ? JSON.stringify(metadata) : null;

  if (userId) {
    // Send to specific user
    db.run(
      'INSERT INTO notifications (user_id, type, title, message, metadata) VALUES (?, ?, ?, ?, ?)',
      [userId, type, title, message, metadataJson],
      function(err) {
        if (err) {
          console.error('Failed to send notification:', err);
        } else {
          console.log(`Notification sent to user ${userId}: ${title}`);
        }
      }
    );
  } else {
    // System notification - could be sent to all admins or logged differently
    console.log(`System notification: ${title} - ${message}`);
    
    // Send to all admin users
    db.all(
      'SELECT id FROM users WHERE role = "admin" AND is_active = 1',
      [],
      (err, admins) => {
        if (err) {
          console.error('Failed to get admin users for notification:', err);
          return;
        }

        admins.forEach(admin => {
          db.run(
            'INSERT INTO notifications (user_id, type, title, message, metadata) VALUES (?, ?, ?, ?, ?)',
            [admin.id, type, title, message, metadataJson],
            function(err) {
              if (err) {
                console.error(`Failed to send notification to admin ${admin.id}:`, err);
              }
            }
          );
        });
      }
    );
  }
}

/**
 * Send bulk notifications to multiple users
 * @param {number[]} userIds - Array of user IDs
 * @param {string} type - Notification type
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {object} metadata - Additional metadata
 * @param {function} callback - Callback function
 */
function sendBulkNotifications(userIds, type, title, message, metadata = null, callback) {
  if (!userIds || userIds.length === 0) {
    return callback(new Error('No user IDs provided'), null);
  }

  const metadataJson = metadata ? JSON.stringify(metadata) : null;

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    let processedCount = 0;
    let hasError = false;

    userIds.forEach(userId => {
      db.run(
        'INSERT INTO notifications (user_id, type, title, message, metadata) VALUES (?, ?, ?, ?, ?)',
        [userId, type, title, message, metadataJson],
        function(err) {
          if (err) {
            hasError = true;
            db.run('ROLLBACK');
            return callback(err, null);
          }

          processedCount++;

          if (processedCount === userIds.length && !hasError) {
            db.run('COMMIT', (err) => {
              if (err) {
                return callback(err, null);
              }

              callback(null, {
                message: 'Bulk notifications sent successfully',
                sentCount: processedCount
              });
            });
          }
        }
      );
    });
  });
}

/**
 * Send notification to all users with specific role
 * @param {string} role - User role (admin, customer, etc.)
 * @param {string} type - Notification type
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {object} metadata - Additional metadata
 * @param {function} callback - Callback function
 */
function sendNotificationToRole(role, type, title, message, metadata = null, callback) {
  db.all(
    'SELECT id FROM users WHERE role = ? AND is_active = 1',
    [role],
    (err, users) => {
      if (err) {
        return callback(err, null);
      }

      if (users.length === 0) {
        return callback(null, { message: 'No users found with specified role', sentCount: 0 });
      }

      const userIds = users.map(user => user.id);
      sendBulkNotifications(userIds, type, title, message, metadata, callback);
    }
  );
}

/**
 * Send order-related notifications
 */
const orderNotifications = {
  created: (userId, orderNumber) => {
    sendNotification(
      userId,
      'order_created',
      'Order Created',
      `Your order ${orderNumber} has been created successfully.`,
      { orderNumber }
    );
  },

  confirmed: (userId, orderNumber) => {
    sendNotification(
      userId,
      'order_confirmed',
      'Order Confirmed',
      `Your order ${orderNumber} has been confirmed and is being processed.`,
      { orderNumber }
    );
  },

  shipped: (userId, orderNumber, trackingNumber = null) => {
    const message = trackingNumber 
      ? `Your order ${orderNumber} has been shipped. Tracking number: ${trackingNumber}`
      : `Your order ${orderNumber} has been shipped.`;
    
    sendNotification(
      userId,
      'order_shipped',
      'Order Shipped',
      message,
      { orderNumber, trackingNumber }
    );
  },

  delivered: (userId, orderNumber) => {
    sendNotification(
      userId,
      'order_delivered',
      'Order Delivered',
      `Your order ${orderNumber} has been delivered successfully.`,
      { orderNumber }
    );
  },

  cancelled: (userId, orderNumber, reason = null) => {
    const message = reason 
      ? `Your order ${orderNumber} has been cancelled. Reason: ${reason}`
      : `Your order ${orderNumber} has been cancelled.`;
    
    sendNotification(
      userId,
      'order_cancelled',
      'Order Cancelled',
      message,
      { orderNumber, reason }
    );
  }
};

/**
 * Send payment-related notifications
 */
const paymentNotifications = {
  success: (userId, orderNumber, amount) => {
    sendNotification(
      userId,
      'payment_success',
      'Payment Successful',
      `Payment of $${amount} for order ${orderNumber} has been processed successfully.`,
      { orderNumber, amount }
    );
  },

  failed: (userId, orderNumber, amount, reason = null) => {
    const message = reason 
      ? `Payment of $${amount} for order ${orderNumber} failed. Reason: ${reason}`
      : `Payment of $${amount} for order ${orderNumber} failed. Please try again.`;
    
    sendNotification(
      userId,
      'payment_failed',
      'Payment Failed',
      message,
      { orderNumber, amount, reason }
    );
  },

  refunded: (userId, orderNumber, amount) => {
    sendNotification(
      userId,
      'payment_refunded',
      'Payment Refunded',
      `A refund of $${amount} has been processed for order ${orderNumber}.`,
      { orderNumber, amount }
    );
  }
};

/**
 * Send inventory-related notifications
 */
const inventoryNotifications = {
  lowStock: (productName, currentStock, reorderLevel) => {
    sendNotification(
      null, // System notification
      'low_stock_alert',
      'Low Stock Alert',
      `Product "${productName}" is running low on stock. Current: ${currentStock}, Reorder level: ${reorderLevel}`,
      { productName, currentStock, reorderLevel }
    );
  },

  outOfStock: (productName) => {
    sendNotification(
      null, // System notification
      'out_of_stock_alert',
      'Out of Stock Alert',
      `Product "${productName}" is now out of stock.`,
      { productName }
    );
  },

  restocked: (productName, newStock) => {
    sendNotification(
      null, // System notification
      'restock_alert',
      'Product Restocked',
      `Product "${productName}" has been restocked. New quantity: ${newStock}`,
      { productName, newStock }
    );
  }
};

/**
 * Send user account notifications
 */
const userNotifications = {
  welcome: (userId, firstName) => {
    sendNotification(
      userId,
      'welcome',
      'Welcome to Our Store!',
      `Welcome ${firstName}! Thank you for joining our store. Start shopping now and enjoy great deals!`,
      { firstName }
    );
  },

  passwordChanged: (userId) => {
    sendNotification(
      userId,
      'password_changed',
      'Password Changed',
      'Your password has been changed successfully. If you did not make this change, please contact support immediately.',
      {}
    );
  },

  profileUpdated: (userId) => {
    sendNotification(
      userId,
      'profile_updated',
      'Profile Updated',
      'Your profile information has been updated successfully.',
      {}
    );
  }
};

/**
 * Get notification templates
 * @param {string} type - Notification type
 * @returns {object} Template object with title and message
 */
function getNotificationTemplate(type) {
  const templates = {
    order_created: {
      title: 'Order Created',
      message: 'Your order has been created successfully.'
    },
    order_confirmed: {
      title: 'Order Confirmed',
      message: 'Your order has been confirmed and is being processed.'
    },
    order_shipped: {
      title: 'Order Shipped',
      message: 'Your order has been shipped.'
    },
    order_delivered: {
      title: 'Order Delivered',
      message: 'Your order has been delivered successfully.'
    },
    order_cancelled: {
      title: 'Order Cancelled',
      message: 'Your order has been cancelled.'
    },
    payment_success: {
      title: 'Payment Successful',
      message: 'Your payment has been processed successfully.'
    },
    payment_failed: {
      title: 'Payment Failed',
      message: 'Your payment failed. Please try again.'
    },
    payment_refunded: {
      title: 'Payment Refunded',
      message: 'Your refund has been processed.'
    },
    low_stock_alert: {
      title: 'Low Stock Alert',
      message: 'Product is running low on stock.'
    },
    out_of_stock_alert: {
      title: 'Out of Stock Alert',
      message: 'Product is now out of stock.'
    },
    welcome: {
      title: 'Welcome!',
      message: 'Welcome to our store!'
    }
  };

  return templates[type] || { title: 'Notification', message: 'You have a new notification.' };
}

module.exports = {
  sendNotification,
  sendBulkNotifications,
  sendNotificationToRole,
  orderNotifications,
  paymentNotifications,
  inventoryNotifications,
  userNotifications,
  getNotificationTemplate
};
