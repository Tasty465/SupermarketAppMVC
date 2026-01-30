require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MVC imports
const ProductController = require('./Controllers/productcontroller');
const UserController = require('./Controllers/usercontroller');
const InvoiceController = require('./Controllers/invoicecontroller');
const ProductModel = require('./Models/product');
const UserModel = require('./Models/user');
const InvoiceModel = require('./Models/invoice');

// Payment service imports
const NETSService = require('./services/nets');
const StripeService = require('./services/stripe');
const cartcontroller = require('./Controllers/cartcontroller');
const paypalClient = require("./services/paypal");
const checkoutNodeJssdk = require("@paypal/checkout-server-sdk");


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
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: 'application/octet-stream' }));

app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(flash());

app.use((req, res, next) => {
  res.locals.success = req.flash('success') || [];
  res.locals.error = req.flash('error') || [];
  res.locals.user = req.session && req.session.user ? req.session.user : null;
  const cart = req.session && req.session.cart ? req.session.cart : [];
  res.locals.cartCount = Array.isArray(cart) ? cart.reduce((s, it) => s + (parseInt(it.quantity, 10) || 0), 0) : 0;
  next();
});

app.use((req, res, next) => {
  const originalRedirect = res.redirect.bind(res);
  res.redirect = function (url) {
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

// Dashboard for regular users (shows featured / popular products)
app.get('/dashboard', checkAuthenticated, (req, res) => {
  const cb = (err, products) => {
    if (err) {
      console.error('Error fetching products for dashboard:', err);
      return res.status(500).send('Internal Server Error');
    }

    // pick a few featured products (first 5) and some popular products (random sample)
    const featured = Array.isArray(products) ? products.slice(0, 5) : [];
    const shuffled = Array.isArray(products) ? products.slice().sort(() => 0.5 - Math.random()) : [];
    const popular = shuffled.slice(0, 6);

    res.render('dashboard', { user: req.session.user, featured, popular });
  };
  ProductModel.getAll(cb);
});


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


app.post('/checkout', checkAuthenticated, (req, res) => {
  console.log('POST /checkout called; session user=', req.session && req.session.user ? req.session.user.username : 'none');
  const cart = req.session.cart || [];
  if (!cart.length) {
    req.flash('error', 'Your cart is empty');
    return res.redirect('/cart');
  }

  const checks = cart.map(item => new Promise((resolve, reject) => {
    ProductModel.getById(item.id, (err, product) => {
      if (err) return reject(err);
      if (!product) return reject(new Error('Product not found'));
      if (product.quantity < item.quantity) return resolve({ ok: false, id: item.id, available: product.quantity, name: product.productName });
      resolve({ ok: true, product, item });
    });
  }));

  Promise.all(checks)
    .then(results => {
      const insufficient = results.find(r => r.ok === false);
      if (insufficient) {
        console.log('Checkout failed - insufficient stock for', insufficient.name, 'available=', insufficient.available);
        req.flash('error', `Insufficient stock for ${insufficient.name} (available: ${insufficient.available})`);
        return res.redirect('/cart');
      }

      const updates = results.map(r => new Promise((resolve, reject) => {
        const newQty = r.product.quantity - r.item.quantity;
        ProductModel.updateQuantity(r.product.id, newQty, (err) => {
          if (err) return reject(err);
          resolve();
        });
      }));

      return Promise.all(updates).then(() => {
        console.log('Checkout successful for user=', req.session && req.session.user ? req.session.user.username : 'unknown');
       
            let subtotal = 0;
            const invoiceItems = cart.map(item => {
              const lineTotal = item.price * item.quantity;
              subtotal += lineTotal;
              return { ...item, lineTotal };
            });
            const tax = subtotal * 0.09;
            const total = subtotal + tax;

            const invoiceNumber = 'INV-' + Date.now();
            const invoiceData = {
              invoice_number: invoiceNumber,
              user_id: req.session.user.id,
              subtotal,
              tax,
              total
            };

            const itemsForDb = invoiceItems.map(it => ({
              product_id: it.id,
              product_name: it.productName,
              price: it.price,
              quantity: it.quantity,
              line_total: it.lineTotal
            }));

            InvoiceModel.createInvoice(invoiceData, itemsForDb, (err, result) => {
              if (err) {
                console.error('Failed to persist invoice:', err);
                // fallback to session-stored invoice so user can still see it immediately
                req.session.invoice = {
                  invoiceNumber,
                  date: new Date().toLocaleDateString('en-US'),
                  items: invoiceItems,
                  subtotal,
                  tax,
                  total,
                  customer: req.session.user.username
                };
                req.session.cart = [];
                return res.redirect('/invoice');
              }
              req.session.cart = [];
              res.redirect('/invoice/' + result.invoiceId);
            });
      });
    })
    .catch(err => {
      console.error('Checkout error', err);
      res.status(500).send('Internal Server Error');
    });
});

app.get('/cart', checkAuthenticated, (req, res) => {
  const cart = req.session.cart || [];
  res.render('cart', { cart, user: req.session.user });
});

app.get('/invoice', checkAuthenticated, (req, res) => {
  const invoice = req.session.invoice;
  if (!invoice) {
    req.flash('error', 'No invoice found');
    return res.redirect('/cart');
  }
  res.render('invoice', { invoice, user: req.session.user });
});

// Persisted invoices: list and detail views
app.get('/invoices', checkAuthenticated, InvoiceController.list);
app.get('/invoice/:id', checkAuthenticated, InvoiceController.getById);
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
app.post('/updateCart/:id', checkAuthenticated, (req, res) => {
  const productId = parseInt(req.params.id, 10);
  const newQty = parseInt(req.body.quantity, 10);
  const cart = req.session.cart || [];
  const itemIndex = cart.findIndex(item => item.id === productId);
  if (itemIndex !== -1) {
    cart[itemIndex].quantity = newQty;
    req.session.cart = cart;
  }
  res.redirect('/cart');
});
app.get('/deleteCart/:id', checkAuthenticated, (req, res) => {
  const productId = parseInt(req.params.id, 10);
  let cart = req.session.cart || [];
  cart = cart.filter(item => item.id !== productId);
  req.session.cart = cart;
  res.redirect('/cart');
}),



app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.update);
app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, ProductController.delete);
app.get('/product/:id/delete', ProductController.delete);
app.get('/users', checkAuthenticated, checkAdmin, UserController.list);
app.get('/user/:id', checkAuthenticated, checkAdmin, UserController.getById);
app.post('/user/:id/update', checkAuthenticated, checkAdmin, UserController.update);
app.get('/user/:id/delete', checkAuthenticated, checkAdmin, UserController.delete);
app.post('/updatecart/:id',cartcontroller.update);
app.get('/deletecart/:id',cartcontroller.remove); 


// ==================== PAYMENT ROUTES ====================

// Payment method selection page
app.get('/payment', checkAuthenticated, (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length) {
    req.flash('error', 'Your cart is empty');
    return res.redirect('/cart');
  }
  
  let subtotal = 0;
  cart.forEach(item => {
    subtotal += item.price * item.quantity;
  });
  const tax = subtotal * 0.09;
  const total = subtotal + tax;

  res.render('payment/selectPaymentMethod', { 
    total: total.toFixed(2),
    stripePublicKey: process.env.STRIPE_PUBLIC_KEY,
    user: req.session.user 
  });
});

// Stripe Checkout Page
app.get('/payment/stripe/checkout', checkAuthenticated, (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length) {
    req.flash('error', 'Your cart is empty');
    return res.redirect('/cart');
  }

  let subtotal = 0;
  cart.forEach(item => {
    subtotal += item.price * item.quantity;
  });
  const tax = subtotal * 0.09;
  const total = subtotal + tax;

  res.render('payment/stripeCheckout', { 
    total: total.toFixed(2),
    stripePublicKey: process.env.STRIPE_PUBLIC_KEY,
    user: req.session.user 
  });
});

// NETS QR Payment Routes
app.post('/payment/nets-qr/generate', checkAuthenticated, NETSService.generateQrCode);

app.get('/sse/payment-status/:txnRetrievalRef', async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const txnRetrievalRef = req.params.txnRetrievalRef;
  let pollCount = 0;
  const maxPolls = 60;
  let frontendTimeoutStatus = 0;

  const interval = setInterval(async () => {
    pollCount++;

    try {
      const response = await NETSService.queryPaymentStatus(txnRetrievalRef, frontendTimeoutStatus);
      console.log("Polling response:", response);
      res.write(`data: ${JSON.stringify(response)}\n\n`);
    
      const resData = response.result?.data;

      if (resData && resData.response_code == "00" && resData.txn_status === 1) {
        res.write(`data: ${JSON.stringify({ success: true })}\n\n`);
        clearInterval(interval);
        res.end();
      } else if (frontendTimeoutStatus == 1 && resData && (resData.response_code !== "00" || resData.txn_status === 2)) {
        res.write(`data: ${JSON.stringify({ fail: true, ...resData })}\n\n`);
        clearInterval(interval);
        res.end();
      }

    } catch (err) {
      clearInterval(interval);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }

    if (pollCount >= maxPolls) {
      clearInterval(interval);
      frontendTimeoutStatus = 1;
      res.write(`data: ${JSON.stringify({ fail: true, error: "Timeout" })}\n\n`);
      res.end();
    }
  }, 5000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

app.get('/payment/nets-qr/success', checkAuthenticated, (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length) {
    req.flash('error', 'No pending transaction');
    return res.redirect('/cart');
  }

  let subtotal = 0;
  const invoiceItems = cart.map(item => {
    const lineTotal = item.price * item.quantity;
    subtotal += lineTotal;
    return { ...item, lineTotal };
  });
  const tax = subtotal * 0.09;
  const total = subtotal + tax;

  const invoiceNumber = 'INV-' + Date.now();
  const invoiceData = {
    invoice_number: invoiceNumber,
    user_id: req.session.user.id,
    subtotal,
    tax,
    total,
    payment_method: 'NETS QR'
  };

  const itemsForDb = invoiceItems.map(it => ({
    product_id: it.id,
    product_name: it.productName,
    price: it.price,
    quantity: it.quantity,
    line_total: it.lineTotal
  }));

  InvoiceModel.createInvoice(invoiceData, itemsForDb, (err, result) => {
    if (err) {
      console.error('Failed to persist invoice:', err);
      req.session.invoice = {
        invoiceNumber,
        date: new Date().toLocaleDateString('en-US'),
        items: invoiceItems,
        subtotal,
        tax,
        total,
        customer: req.session.user.username,
        paymentMethod: 'NETS QR',
        paymentStatus: 'Completed'
      };
      req.session.cart = [];
      return res.render('payment/paymentSuccess', { invoice: req.session.invoice, method: 'NETS QR' });
    }
    req.session.cart = [];
    res.render('payment/paymentSuccess', { 
      invoice: {
        invoiceNumber,
        id: result.invoiceId,
        date: new Date().toLocaleDateString('en-US'),
        items: invoiceItems,
        subtotal,
        tax,
        total,
        customer: req.session.user.username,
        paymentMethod: 'NETS QR',
        paymentStatus: 'Completed'
      },
      method: 'NETS QR' 
    });
  });
});

app.get('/payment/nets-qr/fail', checkAuthenticated, (req, res) => {
  res.render('payment/paymentFail', { 
    method: 'NETS QR',
    message: 'Your NETS QR payment could not be completed. Please try again.'
  });
});

// Stripe Payment Routes
app.post('/payment/stripe/create-intent', checkAuthenticated, StripeService.createPaymentIntent);

app.post('/payment/stripe/confirm', checkAuthenticated, async (req, res) => {
  const { paymentIntentId } = req.body;
  
  try {
    const paymentStatus = await StripeService.confirmPayment(paymentIntentId);
    
    if (paymentStatus.status === 'succeeded') {
      const cart = req.session.cart || [];
      if (!cart.length) {
        return res.json({ error: 'No items in cart' });
      }

      let subtotal = 0;
      const invoiceItems = cart.map(item => {
        const lineTotal = item.price * item.quantity;
        subtotal += lineTotal;
        return { ...item, lineTotal };
      });
      const tax = subtotal * 0.09;
      const total = subtotal + tax;

      const invoiceNumber = 'INV-' + Date.now();
      const invoiceData = {
        invoice_number: invoiceNumber,
        user_id: req.session.user.id,
        subtotal,
        tax,
        total,
        payment_method: 'Stripe'
      };

      const itemsForDb = invoiceItems.map(it => ({
        product_id: it.id,
        product_name: it.productName,
        price: it.price,
        quantity: it.quantity,
        line_total: it.lineTotal
      }));

      InvoiceModel.createInvoice(invoiceData, itemsForDb, (err, result) => {
        req.session.cart = [];
        if (err) {
          console.error('Failed to persist invoice:', err);
          req.session.invoice = {
            invoiceNumber,
            date: new Date().toLocaleDateString('en-US'),
            items: invoiceItems,
            subtotal,
            tax,
            total,
            customer: req.session.user.username,
            paymentMethod: 'Stripe',
            paymentStatus: 'Completed'
          };
          return res.json({ success: true, invoiceId: null });
        }
        res.json({ success: true, invoiceId: result.invoiceId });
      });
    } else {
      res.json({ error: 'Payment not completed' });
    }
  } catch (error) {
    console.error('Error confirming payment:', error);
    res.json({ error: error.message });
  }
});

app.get('/payment/stripe/success', checkAuthenticated, (req, res) => {
  if (req.session.invoice) {
    res.render('payment/paymentSuccess', { 
      invoice: req.session.invoice,
      method: 'Stripe' 
    });
  } else {
    res.render('payment/paymentSuccess', { 
      invoice: {
        invoiceNumber: 'INV-' + Date.now(),
        date: new Date().toLocaleDateString('en-US'),
        paymentMethod: 'Stripe',
        paymentStatus: 'Completed'
      },
      method: 'Stripe' 
    });
  }
});

app.get('/payment/stripe/fail', checkAuthenticated, (req, res) => {
  res.render('payment/paymentFail', { 
    method: 'Stripe',
    message: 'Your Stripe payment could not be completed. Please try again.'
  });
});
// Cancel
app.get("/cancel", (req, res) => {
    res.send("Payment cancelled");
});

app.get("/payment/Paypal", checkAuthenticated, (req, res) => {
  const cart = req.session.cart || [];
  let subtotal = 0;

  cart.forEach(item => {
    subtotal += item.price * item.quantity;
  });

  const tax = subtotal * 0.09;
  const total = (subtotal + tax).toFixed(2);

  res.render("payment/Paypal", { cart, subtotal, tax, total });
});

app.post("/payment/paypal", checkAuthenticated, async (req, res) => {
  console.log("PAYPAL BODY:", req.body);

  const orderID = req.body.orderID;

  if (!orderID) {
    return res.status(400).json({ error: "Missing PayPal order ID" });
  }

  try {
    const capture = await paypalClient.captureOrder(orderID);

    if (capture.status !== "COMPLETED") {
      return res.json({ error: "PayPal payment not completed" });
    }

    const cart = req.session.cart || [];
    if (!cart.length) {
      return res.json({ error: "No items in cart" });
    }

    let subtotal = 0;
    const invoiceItems = cart.map(item => {
      const lineTotal = item.price * item.quantity;
      subtotal += lineTotal;
      return { ...item, lineTotal };
    });

    const tax = subtotal * 0.09;
    const total = subtotal + tax;

    const invoiceNumber = "INV-" + Date.now();

    const invoiceData = {
      invoice_number: invoiceNumber,
      user_id: req.session.user.id,
      subtotal,
      tax,
      total,
      payment_method: "Paypal"
    };

    const itemsForDb = invoiceItems.map(it => ({
      product_id: it.id,
      product_name: it.productName,
      price: it.price,
      quantity: it.quantity,
      line_total: it.lineTotal
    }));

    InvoiceModel.createInvoice(invoiceData, itemsForDb, (err, result) => {
      req.session.cart = [];

      req.session.invoice = {
        invoiceNumber,
        date: new Date().toLocaleDateString("en-US"),
        items: invoiceItems,
        subtotal,
        tax,
        total,
        customer: req.session.user.username,
        paymentMethod: "Paypal",
        paymentStatus: "Completed"
      };

      if (err) {
        console.error("Invoice DB error:", err);
        return res.json({ success: true, invoiceId: null });
      }

      res.json({ success: true, invoiceId: result.invoiceId });
    });

  } catch (err) {
    console.error("PayPal capture error:", err);
    res.status(500).json({ error: "PayPal capture failed" });
  }
});

app.get('/paypal', (req, res) => {
  
  const total = req.query.total || 20.00; 
  res.render('payment/Paypal', { total: total });
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
