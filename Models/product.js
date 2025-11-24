const db = require('../db');

const ProductModel = {
  getAll: function(callback) {
    const sql = 'SELECT id, productName, quantity, price, image FROM products';
    db.query(sql, (err, results) => {
      if (err) return callback(err);
      callback(null, results);
    });
  },

  getById: function(id, callback) {
    const sql = 'SELECT id, productName, quantity, price, image FROM products WHERE id = ?';
    db.query(sql, [id], (err, results) => {
      if (err) return callback(err);
      callback(null, results[0] || null);
    });
  },

  create: function(productData, callback) {
    // insert only product columns (id is auto-increment)
    const sql = 'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)';
    const params = [
      productData.productName,
      typeof productData.quantity !== 'undefined' ? productData.quantity : 0,
      typeof productData.price !== 'undefined' ? productData.price : 0,
      productData.image || null
    ];
    db.query(sql, params, (err, result) => {
      if (err) return callback(err);
      // return created object with generated id
      callback(null, { id: result.insertId, ...productData });
    });
  },

  update: function(id, productData, callback) {
    const sql = 'UPDATE products SET productName = ?, quantity = ?, price = ?, image = ? WHERE id = ?';
    const params = [
      productData.productName,
      productData.quantity,
      productData.price,
      productData.image || null,
      id
    ];
    db.query(sql, params, (err, result) => {
      if (err) return callback(err);
      callback(null, { affectedRows: result.affectedRows });
    });
  },

  delete: function(id, callback) {
    const sql = 'DELETE FROM products WHERE id = ?';
    db.query(sql, [id], (err, result) => {
      if (err) return callback(err);
      callback(null, { affectedRows: result.affectedRows });
    });
  },

  updateQuantity: function(id, quantity, callback) {
    const sql = 'UPDATE products SET quantity = ? WHERE id = ?';
    db.query(sql, [quantity, id], (err, result) => {
      if (err) return callback(err);
      callback(null, { affectedRows: result.affectedRows });
    });
  }
,
  searchByName: function(name, callback) {
    if (!name || !name.trim()) return this.getAll(callback);
    const sql = 'SELECT id, productName, quantity, price, image FROM products WHERE productName LIKE ?';
    const param = `%${name}%`;
    db.query(sql, [param], (err, results) => {
      if (err) return callback(err);
      callback(null, results);
    });
  }
};

module.exports = ProductModel;