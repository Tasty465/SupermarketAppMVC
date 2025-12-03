const db = require('../db');

const InvoiceModel = {
  createInvoice: function (invoiceData, items, callback) {
    // invoiceData: { invoice_number, user_id, subtotal, tax, total }
    db.beginTransaction(err => {
      if (err) return callback(err);
      const sqlInv = 'INSERT INTO invoices (invoice_number, user_id, created_at, subtotal, tax, total) VALUES (?, ?, NOW(), ?, ?, ?)';
      db.query(sqlInv, [invoiceData.invoice_number, invoiceData.user_id, invoiceData.subtotal, invoiceData.tax, invoiceData.total], (err, result) => {
        if (err) return db.rollback(() => callback(err));
        const invoiceId = result.insertId;
        if (!items || items.length === 0) {
          // commit and return
          return db.commit(err2 => {
            if (err2) return db.rollback(() => callback(err2));
            callback(null, { invoiceId });
          });
        }

        const sqlItem = 'INSERT INTO invoice_items (invoice_id, product_id, product_name, price, quantity, line_total) VALUES ?';
        const values = items.map(it => [invoiceId, it.product_id || null, it.product_name || null, it.price || 0, it.quantity || 0, it.line_total || 0]);
        db.query(sqlItem, [values], (err2) => {
          if (err2) return db.rollback(() => callback(err2));
          db.commit(err3 => {
            if (err3) return db.rollback(() => callback(err3));
            callback(null, { invoiceId });
          });
        });
      });
    });
  },

  getById: function (id, callback) {
    const sqlInv = 'SELECT * FROM invoices WHERE id = ?';
    db.query(sqlInv, [id], (err, rows) => {
      if (err) return callback(err);
      if (!rows || rows.length === 0) return callback(null, null);
      const invoice = rows[0];
      const sqlItems = 'SELECT * FROM invoice_items WHERE invoice_id = ?';
      db.query(sqlItems, [id], (err2, items) => {
        if (err2) return callback(err2);
        invoice.items = items;
        callback(null, invoice);
      });
    });
  },

  getByUserId: function (userId, callback) {
    const sql = 'SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC';
    db.query(sql, [userId], (err, rows) => {
      if (err) return callback(err);
      callback(null, rows);
    });
  },

  getAll: function (callback) {
    const sql = 'SELECT * FROM invoices ORDER BY created_at DESC';
    db.query(sql, (err, rows) => {
      if (err) return callback(err);
      callback(null, rows);
    });
  }
};

module.exports = InvoiceModel;
