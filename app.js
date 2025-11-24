const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const path = require('path');
const app = express();

// MVC imports
const ProductController = require('./Controllers/productcontroller');
const UserController = require('./Controllers/usercontroller');
const ProductModel = require('./Models/product');
const UserModel = require('./Models/user');

// Multer setup for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'images')),
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// View engine & middleware
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(flash());

// NEW: rewrite redirects for admin users so controller redirects to '/' go to '/inventory'
app.use((req, res, next) => {
  const originalRedirect = res.redirect.bind(res);
  res.redirect = function (url) {
    // if admin and redirect target is home, send to inventory instead
    if ((url === '/' || url === '') && req.session && req.session.user && req.session.user.role === 'admin') {
      return originalRedirect('/inventory');
    }
    return originalRedirect(url);
  };
  next();
});


const checkAuthenticated = (req, res, next) => {
  if (req.session.user) return next();
  req.flash('error', 'Please log in to view this resource');
  res.redirect('/login');
};

const checkAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') return next();
  req.flash('error', 'Access denied');
  res.redirect('/shopping');
};

app.get('/', ProductController.list);


app.get('/inventory', checkAuthenticated, checkAdmin, (req, res) => {
  const q = (req.query.q || '').trim();
  const cb = (err, products) => {
    if (err) {
      console.error('Error fetching products for inventory:', err);
      return res.status(500).send('Internal Server Error');
    }
    res.render('inventory', { products, user: req.session.user, query: q });
  };
  if (q) ProductModel.searchByName(q, cb);
  else ProductModel.getAll(cb);
});

app.get('/register', UserController.registerForm);
app.post('/register', UserController.register);

app.get('/login', UserController.loginForm);
app.post('/login', UserController.login);

app.get('/shopping', checkAuthenticated, (req, res) => {
  const q = (req.query.q || '').trim();
  const cb = (err, products) => {
    if (err) {
      console.error('Error fetching products for shopping:', err);
      return res.status(500).send('Internal Server Error');
    }
    res.render('shopping', { products, user: req.session.user, query: q });
  };
  if (q) ProductModel.searchByName(q, cb);
  else ProductModel.getAll(cb);
});

app.post('/add-to-cart/:id', checkAuthenticated, (req, res) => {
  const productId = parseInt(req.params.id, 10);
  const qty = parseInt(req.body.quantity, 10) || 1;

  ProductModel.getById(productId, (err, product) => {
    if (err) {
      console.error('Error fetching product for cart:', err);
      return res.status(500).send('Internal Server Error');
    }
    if (!product) return res.status(404).send('Product not found');

    if (!req.session.cart) req.session.cart = [];

    const existing = req.session.cart.find(i => i.id === productId);
    if (existing) {
      existing.quantity += qty;
    } else {
      req.session.cart.push({
        id: product.id,                
        productName: product.productName,
        price: product.price,
        quantity: qty,
        image: product.image
      });
    }

    res.redirect('/cart');
  });
});

app.get('/cart', checkAuthenticated, (req, res) => {
  const cart = req.session.cart || [];
  res.render('cart', { cart, user: req.session.user });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/product/:id', ProductController.getById);

app.get('/api/products/search', (req, res) => {
  const q = (req.query.q || '').trim();
  ProductModel.searchByName(q, (err, products) => {
    if (err) {
      console.error('Error searching products:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    const suggestions = products.map(p => ({ id: p.id, name: p.productName, image: p.image }));
    res.json(suggestions);
  });
});

app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
  res.render('addProduct', { user: req.session.user });
});
app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.add);

app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, (req, res) => {
  const productId = req.params.id;
  ProductModel.getById(productId, (err, product) => {
    if (err) {
      console.error('Error fetching product for update:', err);
      return res.status(500).send('Internal Server Error');
    }
    if (!product) return res.status(404).send('Product not found');
    res.render('updateProduct', { product, user: req.session.user });
  });
});
app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.update);

app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, ProductController.delete);

app.get('/users', checkAuthenticated, checkAdmin, UserController.list);
app.get('/user/:id', checkAuthenticated, UserController.getById);
app.post('/user/:id/update', checkAuthenticated, UserController.update);
app.get('/user/:id/delete', checkAuthenticated, checkAdmin, UserController.delete);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
