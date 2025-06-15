const express = require('express');
const { db } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get user notifications
router.get('/', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const unreadOnly = req.query.unreadOnly === 'true';

  let whereClause = 'WHERE user_id = ?';
  let queryParams = [userId];

  if (unreadOnly) {
    whereClause += ' AND is_read = 0';
  }

  const query = `
    SELECT *
    FROM notifications
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  queryParams.push(limit, offset);

  db.all(query, queryParams, (err, notifications) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Parse metadata for each notification
    notifications.forEach(notification => {
      if (notification.metadata) {
        try {
          notification.metadata = JSON.parse(notification.metadata);
        } catch (e) {
          notification.metadata = null;
        }
      }
    });

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM notifications ${whereClause}`;
    
    db.get(countQuery, queryParams.slice(0, -2), (err, countResult) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Get unread count
      db.get(
        'SELECT COUNT(*) as unread_count FROM notifications WHERE user_id = ? AND is_read = 0',
        [userId],
        (err, unreadResult) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }

          res.json({
            notifications,
            pagination: {
              page,
              limit,
              total: countResult.total,
              pages: Math.ceil(countResult.total / limit)
            },
            unreadCount: unreadResult.unread_count
          });
        }
      );
    });
  });
});

// Get single notification
router.get('/:id', authenticateToken, (req, res) => {
  const notificationId = req.params.id;
  const userId = req.user.id;

  db.get(
    'SELECT * FROM notifications WHERE id = ? AND user_id = ?',
    [notificationId, userId],
    (err, notification) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!notification) {
        return res.status(404).json({ error: 'Notification not found' });
      }

      // Parse metadata
      if (notification.metadata) {
        try {
          notification.metadata = JSON.parse(notification.metadata);
        } catch (e) {
          notification.metadata = null;
        }
      }

      res.json({ notification });
    }
  );
});

// Mark notification as read
router.put('/:id/read', authenticateToken, (req, res) => {
  const notificationId = req.params.id;
  const userId = req.user.id;

  db.run(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
    [notificationId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Notification not found' });
      }

      res.json({ message: 'Notification marked as read' });
    }
  );
});

// Mark all notifications as read
router.put('/read-all', authenticateToken, (req, res) => {
  const userId = req.user.id;

  db.run(
    'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
    [userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({ 
        message: 'All notifications marked as read',
        updatedCount: this.changes
      });
    }
  );
});

// Delete notification
router.delete('/:id', authenticateToken, (req, res) => {
  const notificationId = req.params.id;
  const userId = req.user.id;

  db.run(
    'DELETE FROM notifications WHERE id = ? AND user_id = ?',
    [notificationId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Notification not found' });
      }

      res.json({ message: 'Notification deleted successfully' });
    }
  );
});

// Delete all read notifications
router.delete('/read/clear', authenticateToken, (req, res) => {
  const userId = req.user.id;

  db.run(
    'DELETE FROM notifications WHERE user_id = ? AND is_read = 1',
    [userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({ 
        message: 'Read notifications cleared successfully',
        deletedCount: this.changes
      });
    }
  );
});

// Send notification (Admin only)
router.post('/send', authenticateToken, requireAdmin, (req, res) => {
  const { userId, type, title, message, metadata } = req.body;

  if (!type || !title || !message) {
    return res.status(400).json({ error: 'Type, title, and message are required' });
  }

  const metadataJson = metadata ? JSON.stringify(metadata) : null;

  if (userId) {
    // Send to specific user
    db.run(
      'INSERT INTO notifications (user_id, type, title, message, metadata) VALUES (?, ?, ?, ?, ?)',
      [userId, type, title, message, metadataJson],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to send notification' });
        }

        res.status(201).json({
          message: 'Notification sent successfully',
          notificationId: this.lastID
        });
      }
    );
  } else {
    // Send to all users
    db.all('SELECT id FROM users WHERE is_active = 1', [], (err, users) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (users.length === 0) {
        return res.status(404).json({ error: 'No active users found' });
      }

      db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        let processedCount = 0;
        let hasError = false;

        users.forEach(user => {
          db.run(
            'INSERT INTO notifications (user_id, type, title, message, metadata) VALUES (?, ?, ?, ?, ?)',
            [user.id, type, title, message, metadataJson],
            function(err) {
              if (err) {
                hasError = true;
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'Failed to send notifications' });
              }

              processedCount++;

              if (processedCount === users.length && !hasError) {
                db.run('COMMIT', (err) => {
                  if (err) {
                    return res.status(500).json({ error: 'Failed to commit notifications' });
                  }

                  res.status(201).json({
                    message: 'Notifications sent to all users successfully',
                    sentCount: processedCount
                  });
                });
              }
            }
          );
        });
      });
    });
  }
});

// Get notification statistics (Admin only)
router.get('/stats/summary', authenticateToken, requireAdmin, (req, res) => {
  const queries = [
    'SELECT COUNT(*) as total_notifications FROM notifications',
    'SELECT COUNT(*) as unread_notifications FROM notifications WHERE is_read = 0',
    'SELECT COUNT(DISTINCT user_id) as users_with_notifications FROM notifications',
    'SELECT type, COUNT(*) as count FROM notifications GROUP BY type ORDER BY count DESC LIMIT 5'
  ];

  const stats = {};
  let queriesCompleted = 0;

  // Execute first 3 queries
  queries.slice(0, 3).forEach((query, index) => {
    db.get(query, [], (err, result) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const key = Object.keys(result)[0];
      stats[key] = result[key] || 0;
      queriesCompleted++;

      if (queriesCompleted === 3) {
        // Execute the group by query separately
        db.all(queries[3], [], (err, typeStats) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }

          stats.notification_types = typeStats;
          res.json({ stats });
        });
      }
    });
  });
});

// Get system notifications (Admin only)
router.get('/system/all', authenticateToken, requireAdmin, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const type = req.query.type;

  let whereClause = 'WHERE 1=1';
  let queryParams = [];

  if (type) {
    whereClause += ' AND type = ?';
    queryParams.push(type);
  }

  const query = `
    SELECT 
      n.*,
      u.username,
      u.first_name,
      u.last_name
    FROM notifications n
    LEFT JOIN users u ON n.user_id = u.id
    ${whereClause}
    ORDER BY n.created_at DESC
    LIMIT ? OFFSET ?
  `;

  queryParams.push(limit, offset);

  db.all(query, queryParams, (err, notifications) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Parse metadata for each notification
    notifications.forEach(notification => {
      if (notification.metadata) {
        try {
          notification.metadata = JSON.parse(notification.metadata);
        } catch (e) {
          notification.metadata = null;
        }
      }
    });

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM notifications ${whereClause}`;
    
    db.get(countQuery, queryParams.slice(0, -2), (err, countResult) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        notifications,
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

module.exports = router;
