const db = require('../db');

const UserModel = {
  getAll: function (callback) {
    const sql = 'SELECT id, username, email, password, address, contact, role FROM users';
    db.query(sql, (err, results) => {
      if (err) return callback(err);
      callback(null, results);
    });
  },

  getById: function (id, callback) {
    const sql = 'SELECT id, username, email, password, address, contact, role FROM users WHERE id = ?';
    db.query(sql, [id], (err, results) => {
      if (err) return callback(err);
      callback(null, results[0] || null);
    });
  },

  getByEmail: function (email, callback) {
    const sql = 'SELECT id, username, email, password, address, contact, role FROM users WHERE email = ?';
    db.query(sql, [email], (err, results) => {
      if (err) return callback(err);
      callback(null, results);
    });
  },

  getByUsername: function (username, callback) {
    const sql = 'SELECT id, username, email, password, address, contact, role FROM users WHERE username = ?';
    db.query(sql, [username], (err, results) => {
      if (err) return callback(err);
      callback(null, results);
    });
  },

  create: function (userData, callback) {
    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, ?, ?, ?, ?)';
    const params = [
      userData.username,
      userData.email,
      userData.password,
      userData.address || null,
      userData.contact || null,
      userData.role || 'user'
    ];
    db.query(sql, params, (err, result) => {
      if (err) return callback(err);
      callback(null, { insertId: result.insertId, ...userData });
    });
  },

  update: function (id, userData, callback) {
    const sql = 'UPDATE users SET username = ?, email = ?, password = ?, address = ?, contact = ?, role = ? WHERE id = ?';
    const params = [
      userData.username,
      userData.email,
      userData.password || null,
      userData.address || null,
      userData.contact || null,
      userData.role || null,
      id
    ];
    db.query(sql, params, (err, result) => {
      if (err) return callback(err);
      callback(null, { affectedRows: result.affectedRows });
    });
  },

  delete: function (id, callback) {
    const sql = 'DELETE FROM users WHERE id = ?';
    db.query(sql, [id], (err, result) => {
      if (err) return callback(err);
      callback(null, { affectedRows: result.affectedRows });
    });
  }
};

module.exports = UserModel;