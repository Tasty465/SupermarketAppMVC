const InvoiceModel = require('../Models/invoice');

const InvoiceController = {
  // List invoices for current user (admins will see all)
  list: function (req, res) {
    if (req.session && req.session.user && req.session.user.role === 'admin') {
      InvoiceModel.getAll((err, invoices) => {
        if (err) {
          console.error('Error fetching invoices:', err);
          return res.status(500).send('Internal Server Error');
        }
        res.render('invoices', { invoices, user: req.session.user });
      });
    } else {
      const userId = req.session && req.session.user ? req.session.user.id : null;
      if (!userId) {
        req.flash('error', 'Please log in to view invoices');
        return res.redirect('/login');
      }
      InvoiceModel.getByUserId(userId, (err, invoices) => {
        if (err) {
          console.error('Error fetching user invoices:', err);
          return res.status(500).send('Internal Server Error');
        }
        res.render('invoices', { invoices, user: req.session.user });
      });
    }
  },

  // Show invoice details; only owner or admin may view
  getById: function (req, res) {
    const id = req.params.id;
    InvoiceModel.getById(id, (err, invoice) => {
      if (err) {
        console.error('Error fetching invoice:', err);
        return res.status(500).send('Internal Server Error');
      }
      if (!invoice) return res.status(404).send('Invoice not found');

      const isAdmin = req.session && req.session.user && req.session.user.role === 'admin';
      const userId = req.session && req.session.user ? req.session.user.id : null;
      if (!isAdmin && invoice.user_id !== userId) {
        req.flash('error', 'Access denied');
        return res.redirect('/shopping');
      }

      res.render('invoice_detail', { invoice, user: req.session.user });
    });
  }
};

module.exports = InvoiceController;
