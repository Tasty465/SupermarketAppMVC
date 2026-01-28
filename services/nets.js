const axios = require("axios");

exports.generateQrCode = async (req, res) => {
  const { cartTotal } = req.body;
  console.log("Generating NETS QR Code for amount:", cartTotal);
  
  try {
    const requestBody = {
      txn_id: process.env.NETS_TXN_ID,
      amt_in_dollars: cartTotal,
      notify_mobile: 0,
    };

    const response = await axios.post(
      `https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/request`,
      requestBody,
      {
        headers: {
          "api-key": process.env.NETS_API_KEY,
          "project-id": process.env.NETS_PROJECT_ID,
        },
      }
    );

    const qrData = response.data.result.data;
    console.log("QR Code Response:", { qrData });

    if (
      qrData.response_code === "00" &&
      qrData.txn_status === 1 &&
      qrData.qr_code
    ) {
      console.log("QR code generated successfully");

      const txnRetrievalRef = qrData.txn_retrieval_ref;

      console.log("Transaction retrieval ref:", txnRetrievalRef);

      // Store transaction in session for tracking
      req.session.currentPayment = {
        method: "netsqr",
        txnRetrievalRef: txnRetrievalRef,
        amount: cartTotal,
        status: "pending"
      };

      res.render("payment/netsQr", {
        total: cartTotal,
        title: "Scan to Pay with NETS QR",
        qrCodeUrl: `data:image/png;base64,${qrData.qr_code}`,
        txnRetrievalRef: txnRetrievalRef,
        timer: 300,
        apiKey: process.env.NETS_API_KEY,
        projectId: process.env.NETS_PROJECT_ID,
      });
    } else {
      let errorMsg = "An error occurred while generating the QR code.";
      if (qrData.network_status !== 0) {
        errorMsg = qrData.error_message || "Transaction failed. Please try again.";
      }
      res.render("payment/paymentFail", {
        title: "NETS QR Payment Error",
        errorMsg: errorMsg,
        method: "NETS QR"
      });
    }
  } catch (error) {
    console.error("Error in generateQrCode:", error.message);
    res.render("payment/paymentFail", {
      title: "Payment Error",
      errorMsg: error.message,
      method: "NETS QR"
    });
  }
};

exports.queryPaymentStatus = async (txnRetrievalRef, frontendTimeoutStatus = 0) => {
  try {
    const response = await axios.post(
      'https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/query',
      { 
        txn_retrieval_ref: txnRetrievalRef, 
        frontend_timeout_status: frontendTimeoutStatus 
      },
      {
        headers: {
          'api-key': process.env.NETS_API_KEY,
          'project-id': process.env.NETS_PROJECT_ID,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error("Error querying payment status:", error.message);
    throw error;
  }
};
