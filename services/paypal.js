const checkoutNodeJssdk = require("@paypal/checkout-server-sdk");

function environment() {
    return new checkoutNodeJssdk.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_SECRET
    );
}

const client = new checkoutNodeJssdk.core.PayPalHttpClient(environment());


