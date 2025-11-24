// ...existing code...
const ProductModel = require('../Models/product');
const UserModel = require('../Models/user');

/**
 * ProductController - function based (Express handlers)
 * Uses ProductModel for product-only fields and UserModel only when owner info is needed.
 */
const ProductController = {
  list: function (req, res) {
    ProductModel.getAll((err, products) => {
      if (err) {
        console.error('Error fetching products:', err);
        return res.status(500).send('Internal Server Error');
      }
      // include user so the view can safely reference it
      res.render('index', { products, user: req.user || null });
    });
  },

  getById: function (req, res) {
    const id = req.params.id;
    ProductModel.getById(id, (err, product) => {
      if (err) {
        console.error(`Error fetching product ${id}:`, err);
        return res.status(500).send('Internal Server Error');
      }
      if (!product) return res.status(404).send('Product not found');
      // pass product and a safe user object to the view
      res.render('product', { product, user: (req.session && req.session.user) || req.user || res.locals.user || null });
    });
  },

  add: function (req, res) {
    const productData = {
      productName: req.body.productName || req.body.name || null,
      quantity: req.body.quantity ? parseInt(req.body.quantity, 10) : 0,
      price: req.body.price ? parseFloat(req.body.price) : 0,
      image: req.file ? req.file.filename : (req.body.image || null),
      userId: req.body.userId || null
    };

    ProductModel.create(productData, (err) => {
      if (err) {
        console.error('Error creating product:', err);
        return res.status(500).send('Internal Server Error');
      }
      res.redirect('/');
    });
  },

  editForm: function (req, res) {
    const id = req.params.id;
    ProductModel.getById(id, (err, product) => {
      if (err) {
        console.error(`Error fetching product ${id}:`, err);
        return res.status(500).send('Internal Server Error');
      }
      if (!product) return res.status(404).send('Product not found');
      res.render('editProduct', { product });
    });
  },

  update: function (req, res) {
    const id = req.params.id;
    const productData = {
      productName: req.body.productName || req.body.name || null,
      quantity: typeof req.body.quantity !== 'undefined' ? parseInt(req.body.quantity, 10) : null,
      price: typeof req.body.price !== 'undefined' ? parseFloat(req.body.price) : null,
      image: req.file ? req.file.filename : (req.body.currentImage || req.body.image || null),
      userId: req.body.userId || null
    };

    ProductModel.update(id, productData, (err, result) => {
      if (err) {
        console.error(`Error updating product ${id}:`, err);
        return res.status(500).send('Internal Server Error');
      }
      if (result && result.affectedRows === 0) return res.status(404).send('Product not found');
      res.redirect('/');
    });
  },

  delete: function (req, res) {
    const id = req.params.id;
    ProductModel.delete(id, (err, result) => {
      if (err) {
        console.error(`Error deleting product ${id}:`, err);
        return res.status(500).send('Internal Server Error');
      }
      if (result && result.affectedRows === 0) return res.status(404).send('Product not found');
      res.redirect('/');
    });
  }
};

module.exports = ProductController;