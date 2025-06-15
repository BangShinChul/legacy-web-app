const { db } = require('../config/database');

/**
 * Log activity to audit trail
 * @param {string} tableName - Name of the table being modified
 * @param {number} recordId - ID of the record being modified
 * @param {string} action - Action performed (INSERT, UPDATE, DELETE)
 * @param {object} oldValues - Previous values (for UPDATE/DELETE)
 * @param {object} newValues - New values (for INSERT/UPDATE)
 * @param {number} userId - ID of the user performing the action
 */
function logActivity(tableName, recordId, action, oldValues, newValues, userId) {
  const oldValuesJson = oldValues ? JSON.stringify(oldValues) : null;
  const newValuesJson = newValues ? JSON.stringify(newValues) : null;

  db.run(
    `INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tableName, recordId, action, oldValuesJson, newValuesJson, userId],
    function(err) {
      if (err) {
        console.error('Failed to log audit activity:', err);
      } else {
        console.log(`Audit log created: ${action} on ${tableName}:${recordId} by user:${userId}`);
      }
    }
  );
}

/**
 * Get audit logs with filtering
 * @param {object} filters - Filtering options
 * @param {function} callback - Callback function
 */
function getAuditLogs(filters = {}, callback) {
  const {
    tableName,
    recordId,
    action,
    userId,
    startDate,
    endDate,
    page = 1,
    limit = 50
  } = filters;

  const offset = (page - 1) * limit;
  let whereClause = 'WHERE 1=1';
  let queryParams = [];

  if (tableName) {
    whereClause += ' AND table_name = ?';
    queryParams.push(tableName);
  }

  if (recordId) {
    whereClause += ' AND record_id = ?';
    queryParams.push(recordId);
  }

  if (action) {
    whereClause += ' AND action = ?';
    queryParams.push(action);
  }

  if (userId) {
    whereClause += ' AND user_id = ?';
    queryParams.push(userId);
  }

  if (startDate) {
    whereClause += ' AND created_at >= ?';
    queryParams.push(startDate);
  }

  if (endDate) {
    whereClause += ' AND created_at <= ?';
    queryParams.push(endDate);
  }

  const query = `
    SELECT 
      al.*,
      u.username,
      u.first_name,
      u.last_name
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    ${whereClause}
    ORDER BY al.created_at DESC
    LIMIT ? OFFSET ?
  `;

  queryParams.push(limit, offset);

  db.all(query, queryParams, (err, logs) => {
    if (err) {
      return callback(err, null);
    }

    // Parse JSON values
    logs.forEach(log => {
      if (log.old_values) {
        try {
          log.old_values = JSON.parse(log.old_values);
        } catch (e) {
          log.old_values = null;
        }
      }
      if (log.new_values) {
        try {
          log.new_values = JSON.parse(log.new_values);
        } catch (e) {
          log.new_values = null;
        }
      }
    });

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`;
    
    db.get(countQuery, queryParams.slice(0, -2), (err, countResult) => {
      if (err) {
        return callback(err, null);
      }

      callback(null, {
        logs,
        pagination: {
          page,
          limit,
          total: countResult.total,
          pages: Math.ceil(countResult.total / limit)
        }
      });
    });
  });
}

/**
 * Get audit statistics
 * @param {function} callback - Callback function
 */
function getAuditStats(callback) {
  const queries = [
    'SELECT COUNT(*) as total_logs FROM audit_logs',
    'SELECT COUNT(DISTINCT user_id) as active_users FROM audit_logs WHERE created_at >= datetime("now", "-30 days")',
    'SELECT COUNT(DISTINCT table_name) as affected_tables FROM audit_logs',
    'SELECT action, COUNT(*) as count FROM audit_logs GROUP BY action',
    'SELECT table_name, COUNT(*) as count FROM audit_logs GROUP BY table_name ORDER BY count DESC LIMIT 10'
  ];

  const stats = {};
  let queriesCompleted = 0;

  // Execute individual count queries
  queries.slice(0, 3).forEach((query, index) => {
    db.get(query, [], (err, result) => {
      if (err) {
        return callback(err, null);
      }

      const key = Object.keys(result)[0];
      stats[key] = result[key] || 0;
      queriesCompleted++;

      if (queriesCompleted === 3) {
        // Execute group by queries
        db.all(queries[3], [], (err, actionStats) => {
          if (err) {
            return callback(err, null);
          }

          stats.actions = actionStats;

          db.all(queries[4], [], (err, tableStats) => {
            if (err) {
              return callback(err, null);
            }

            stats.tables = tableStats;
            callback(null, stats);
          });
        });
      }
    });
  });
}

/**
 * Clean old audit logs (older than specified days)
 * @param {number} daysToKeep - Number of days to keep logs
 * @param {function} callback - Callback function
 */
function cleanOldLogs(daysToKeep = 365, callback) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  db.run(
    'DELETE FROM audit_logs WHERE created_at < ?',
    [cutoffDate.toISOString()],
    function(err) {
      if (err) {
        return callback(err, null);
      }

      callback(null, {
        message: 'Old audit logs cleaned successfully',
        deletedCount: this.changes
      });
    }
  );
}

/**
 * Get recent activity for a specific record
 * @param {string} tableName - Table name
 * @param {number} recordId - Record ID
 * @param {number} limit - Number of recent activities to fetch
 * @param {function} callback - Callback function
 */
function getRecordActivity(tableName, recordId, limit = 10, callback) {
  const query = `
    SELECT 
      al.*,
      u.username,
      u.first_name,
      u.last_name
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE al.table_name = ? AND al.record_id = ?
    ORDER BY al.created_at DESC
    LIMIT ?
  `;

  db.all(query, [tableName, recordId, limit], (err, logs) => {
    if (err) {
      return callback(err, null);
    }

    // Parse JSON values
    logs.forEach(log => {
      if (log.old_values) {
        try {
          log.old_values = JSON.parse(log.old_values);
        } catch (e) {
          log.old_values = null;
        }
      }
      if (log.new_values) {
        try {
          log.new_values = JSON.parse(log.new_values);
        } catch (e) {
          log.new_values = null;
        }
      }
    });

    callback(null, logs);
  });
}

module.exports = {
  logActivity,
  getAuditLogs,
  getAuditStats,
  cleanOldLogs,
  getRecordActivity
};
