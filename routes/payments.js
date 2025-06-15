const express = require('express');
const { db } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { processPayment, refundPayment } = require('../services/paymentService');
const { logActivity } = require('../services/auditService');
const { sendNotification } = require('../services/notificationService');

const router = express.Router();

// Process payment for an order
router.post('/process', authenticateToken, async (req, res) => {
  const { orderId, paymentMethod, paymentDetails } = req.body;
  const userId = req.user.id;

  if (!orderId || !paymentMethod) {
    return res.status(400).json({ error: 'Order ID and payment method are required' });
  }

  try {
    // Get order details
    db.get(
      'SELECT * FROM orders WHERE id = ? AND user_id = ? AND payment_status = "pending"',
      [orderId, userId],
      async (err, order) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        if (!order) {
          return res.status(404).json({ error: 'Order not found or already paid' });
        }

        try {
          // Process payment through payment service
          const paymentResult = await processPayment({
            amount: order.total_amount,
            currency: 'USD',
            paymentMethod,
            paymentDetails,
            orderId: order.id,
            customerInfo: {
              userId: userId,
              email: req.user.email
            }
          });

          // Save payment record
          db.run(
            `INSERT INTO payments (
              order_id, payment_method, amount, status, transaction_id, gateway_response, processed_at
            ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [
              orderId,
              paymentMethod,
              order.total_amount,
              paymentResult.status,
              paymentResult.transactionId,
              JSON.stringify(paymentResult.gatewayResponse)
            ],
            function(err) {
              if (err) {
                return res.status(500).json({ error: 'Failed to save payment record' });
              }

              const paymentId = this.lastID;

              // Update order payment status
              const newPaymentStatus = paymentResult.status === 'success' ? 'paid' : 'failed';
              const newOrderStatus = paymentResult.status === 'success' ? 'confirmed' : 'pending';

              db.run(
                'UPDATE orders SET payment_status = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [newPaymentStatus, newOrderStatus, orderId],
                (err) => {
                  if (err) {
                    return res.status(500).json({ error: 'Failed to update order status' });
                  }

                  // Log activity
                  logActivity('payments', paymentId, 'INSERT', null, {
                    orderId, amount: order.total_amount, status: paymentResult.status
                  }, userId);

                  // Send notification
                  const notificationTitle = paymentResult.status === 'success' ? 
                    'Payment Successful' : 'Payment Failed';
                  const notificationMessage = paymentResult.status === 'success' ?
                    `Payment for order ${order.order_number} has been processed successfully.` :
                    `Payment for order ${order.order_number} failed. Please try again.`;

                  sendNotification(userId, 'payment_processed', notificationTitle, notificationMessage);

                  if (paymentResult.status === 'success') {
                    res.json({
                      message: 'Payment processed successfully',
                      paymentId,
                      transactionId: paymentResult.transactionId,
                      status: paymentResult.status
                    });
                  } else {
                    res.status(400).json({
                      error: 'Payment failed',
                      message: paymentResult.message,
                      paymentId
                    });
                  }
                }
              );
            }
          );
        } catch (paymentError) {
          console.error('Payment processing error:', paymentError);
          
          // Save failed payment record
          db.run(
            `INSERT INTO payments (
              order_id, payment_method, amount, status, gateway_response, processed_at
            ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [
              orderId,
              paymentMethod,
              order.total_amount,
              'failed',
              JSON.stringify({ error: paymentError.message })
            ]
          );

          res.status(500).json({ error: 'Payment processing failed', message: paymentError.message });
        }
      }
    );
  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get payment history for user
router.get('/history', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin';
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  let whereClause = isAdmin ? 'WHERE 1=1' : 'WHERE o.user_id = ?';
  let queryParams = isAdmin ? [] : [userId];

  const query = `
    SELECT 
      p.*,
      o.order_number,
      o.total_amount as order_total,
      u.username,
      u.first_name,
      u.last_name
    FROM payments p
    LEFT JOIN orders o ON p.order_id = o.id
    LEFT JOIN users u ON o.user_id = u.id
    ${whereClause}
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `;

  queryParams.push(limit, offset);

  db.all(query, queryParams, (err, payments) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM payments p
      LEFT JOIN orders o ON p.order_id = o.id
      ${whereClause}
    `;

    db.get(countQuery, queryParams.slice(0, -2), (err, countResult) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        payments,
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

// Get single payment details
router.get('/:id', authenticateToken, (req, res) => {
  const paymentId = req.params.id;
  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin';

  let whereClause = isAdmin ? 'WHERE p.id = ?' : 'WHERE p.id = ? AND o.user_id = ?';
  let queryParams = isAdmin ? [paymentId] : [paymentId, userId];

  const query = `
    SELECT 
      p.*,
      o.order_number,
      o.total_amount as order_total,
      o.status as order_status,
      u.username,
      u.first_name,
      u.last_name,
      u.email
    FROM payments p
    LEFT JOIN orders o ON p.order_id = o.id
    LEFT JOIN users u ON o.user_id = u.id
    ${whereClause}
  `;

  db.get(query, queryParams, (err, payment) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Parse gateway response if it exists
    if (payment.gateway_response) {
      try {
        payment.gateway_response = JSON.parse(payment.gateway_response);
      } catch (e) {
        // Keep as string if parsing fails
      }
    }

    res.json({ payment });
  });
});

// Refund payment (Admin only)
router.post('/:id/refund', authenticateToken, requireAdmin, async (req, res) => {
  const paymentId = req.params.id;
  const { amount, reason } = req.body;

  try {
    // Get payment details
    db.get(
      `SELECT p.*, o.order_number, o.user_id 
       FROM payments p 
       LEFT JOIN orders o ON p.order_id = o.id 
       WHERE p.id = ? AND p.status = 'success'`,
      [paymentId],
      async (err, payment) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        if (!payment) {
          return res.status(404).json({ error: 'Payment not found or cannot be refunded' });
        }

        const refundAmount = amount || payment.amount;

        if (refundAmount > payment.amount) {
          return res.status(400).json({ error: 'Refund amount cannot exceed original payment amount' });
        }

        try {
          // Process refund through payment service
          const refundResult = await refundPayment({
            originalTransactionId: payment.transaction_id,
            amount: refundAmount,
            reason: reason || 'Admin refund'
          });

          // Create refund payment record
          db.run(
            `INSERT INTO payments (
              order_id, payment_method, amount, status, transaction_id, gateway_response, processed_at
            ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [
              payment.order_id,
              payment.payment_method,
              -refundAmount, // Negative amount for refund
              'refunded',
              refundResult.refundTransactionId,
              JSON.stringify(refundResult.gatewayResponse)
            ],
            function(err) {
              if (err) {
                return res.status(500).json({ error: 'Failed to save refund record' });
              }

              const refundId = this.lastID;

              // Update original payment status if full refund
              if (refundAmount === payment.amount) {
                db.run(
                  'UPDATE payments SET status = "refunded" WHERE id = ?',
                  [paymentId]
                );

                // Update order status
                db.run(
                  'UPDATE orders SET payment_status = "refunded", status = "cancelled", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                  [payment.order_id]
                );
              }

              // Log activity
              logActivity('payments', refundId, 'INSERT', null, {
                originalPaymentId: paymentId,
                refundAmount,
                reason
              }, req.user.id);

              // Send notification to customer
              sendNotification(
                payment.user_id,
                'payment_refunded',
                'Payment Refunded',
                `A refund of $${refundAmount} has been processed for order ${payment.order_number}.`
              );

              res.json({
                message: 'Refund processed successfully',
                refundId,
                refundTransactionId: refundResult.refundTransactionId,
                amount: refundAmount
              });
            }
          );
        } catch (refundError) {
          console.error('Refund processing error:', refundError);
          res.status(500).json({ error: 'Refund processing failed', message: refundError.message });
        }
      }
    );
  } catch (error) {
    console.error('Refund error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get payment statistics (Admin only)
router.get('/stats/summary', authenticateToken, requireAdmin, (req, res) => {
  const queries = [
    'SELECT COUNT(*) as total_payments FROM payments WHERE status = "success"',
    'SELECT SUM(amount) as total_revenue FROM payments WHERE status = "success" AND amount > 0',
    'SELECT COUNT(*) as failed_payments FROM payments WHERE status = "failed"',
    'SELECT SUM(ABS(amount)) as total_refunds FROM payments WHERE status = "refunded" AND amount < 0',
    'SELECT AVG(amount) as average_payment FROM payments WHERE status = "success" AND amount > 0'
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

// Get payment methods (for frontend)
router.get('/methods/available', (req, res) => {
  const paymentMethods = [
    {
      id: 'credit_card',
      name: 'Credit Card',
      description: 'Visa, MasterCard, American Express',
      enabled: true
    },
    {
      id: 'debit_card',
      name: 'Debit Card',
      description: 'Bank debit card',
      enabled: true
    },
    {
      id: 'paypal',
      name: 'PayPal',
      description: 'Pay with your PayPal account',
      enabled: true
    },
    {
      id: 'bank_transfer',
      name: 'Bank Transfer',
      description: 'Direct bank transfer',
      enabled: false
    }
  ];

  res.json({ paymentMethods });
});

module.exports = router;
