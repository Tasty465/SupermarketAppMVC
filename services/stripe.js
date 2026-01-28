const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.createPaymentIntent = async (req, res) => {
  const { cartTotal } = req.body;
  console.log("Creating Stripe payment intent for amount:", cartTotal);

  try {
    // Convert dollars to cents
    const amountInCents = Math.round(cartTotal * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      metadata: {
        userId: req.session.user?.id || 'guest',
        username: req.session.user?.username || 'unknown'
      }
    });

    // Store transaction in session for tracking
    req.session.currentPayment = {
      method: "stripe",
      paymentIntentId: paymentIntent.id,
      amount: cartTotal,
      status: "pending"
    };

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
  } catch (error) {
    console.error("Error creating payment intent:", error.message);
    res.status(400).json({ 
      error: error.message 
    });
  }
};

exports.handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      console.log('Payment succeeded:', event.data.object);
      // Update database with successful payment
      break;
    case 'payment_intent.payment_failed':
      console.log('Payment failed:', event.data.object);
      // Log failed payment
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
};

exports.confirmPayment = async (paymentIntentId) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return {
      status: paymentIntent.status,
      amount: paymentIntent.amount / 100, // Convert back to dollars
      currency: paymentIntent.currency
    };
  } catch (error) {
    console.error("Error confirming payment:", error.message);
    throw error;
  }
};
