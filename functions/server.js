const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: '*/*' })); // Catch raw text / plain string payloads from SMS forwarders

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: "workingpowersaccol"
  });
}

const db = admin.firestore();

function getWeeklyTarget(levelNumber) {
  const level = parseInt(levelNumber, 10) || 1;
  return 6000 + (level - 1) * 2500;
}

app.get('/', (req, res) => res.send('WPS SACCO Airtel Webhook Live!'));

app.post('/api/sacco/airtel-webhook', async (req, res) => {
  try {
    // Robust message extraction handling JSON objects, query strings, or raw plain text bodies
    let rawBody = req.body;
    if (typeof rawBody === 'object' && rawBody !== null && Buffer.isBuffer(rawBody)) {
      rawBody = rawBody.toString('utf8');
    }

    let message = "";
    if (typeof rawBody === 'string') {
      try {
        const parsed = JSON.parse(rawBody);
        message = parsed.message || parsed.text || parsed.content || parsed.msg || parsed.q || rawBody;
      } catch (e) {
        message = rawBody;
      }
    } else if (typeof rawBody === 'object' && rawBody !== null) {
      message = rawBody.message || rawBody.text || rawBody.content || rawBody.msg || rawBody.q || "";
    }

    console.log("Raw Airtel SMS received:", message);

    // 1. Extract Amount
    const amountMatch = message.match(/UGX\s*([\d,]+)/i);
    const amount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, ""), 10) : 0;

    // 2. Extract Reference (handles "reference", "rererence", or trailing name text)
    const refMatch = message.match(/(?:reference|rererence)\s*([a-zA-Z0-9\-]+)/i);
    const rawRef = refMatch ? refMatch[1].trim().toUpperCase() : "";

    // 3. Extract Txn ID (handles "TID" right at the start of the message)
    const txnMatch = message.match(/(TID\d+)/i);
    const txnId = txnMatch ? txnMatch[1] : `TXN-${Date.now()}`;

    if (!amount || !rawRef) {
      return res.status(200).json({ status: "IGNORED", reason: "Invalid format", receivedContent: message });
    }

    // Check duplicate
    const txnRefDoc = db.collection("transactions").doc(txnId);
    const doc = await txnRefDoc.get();
    if (doc.exists) {
      return res.status(200).json({ status: "ALREADY_PROCESSED" });
    }

    const isLoanPayment = rawRef.includes("LOAN");
    const cleanMemberRef = rawRef.replace(/\bLOAN\b/g, "").trim();

    // Find member
    let memberQuery = await db.collection("members").where("memberRef", "==", cleanMemberRef).get();
    if (memberQuery.empty) {
      memberQuery = await db.collection("members").where("name", "==", cleanMemberRef).get();
    }

    if (memberQuery.empty) {
      return res.status(404).json({ status: "MEMBER_NOT_FOUND" });
    }

    const memberDoc = memberQuery.docs[0];
    const memberId = memberDoc.id;
    const memberData = memberDoc.data();

    // LOAN REPAYMENT
    if (isLoanPayment) {
      const currentLoanBalance = memberData.outstandingLoanBalance || 0;
      const newLoanBalance = Math.max(0, currentLoanBalance - amount);

      await txnRefDoc.set({
        memberRef: cleanMemberRef,
        memberId: memberId,
        amount: amount,
        type: "LOAN_REPAYMENT",
        previousBalance: currentLoanBalance,
        newBalance: newLoanBalance,
        rawMessage: message,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

      await db.collection("members").doc(memberId).update({
        outstandingLoanBalance: newLoanBalance,
        lastLoanPaymentDate: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(200).json({ status: "SUCCESS_LOAN_REPAYMENT", amountPaid: amount, newLoanBalance });
    } 
    // SAVINGS DEPOSIT
    else {
      const memberLevel = memberData.level || 1;
      const weeklyTarget = getWeeklyTarget(memberLevel);
      const weeksCovered = Math.floor(amount / weeklyTarget);

      let currentPaidUntil = memberData.paidUntilDate ? memberData.paidUntilDate.toDate() : new Date();
      if (currentPaidUntil < new Date()) {
        currentPaidUntil = new Date();
      }

      const newPaidUntil = new Date(currentPaidUntil);
      newPaidUntil.setDate(newPaidUntil.getDate() + (weeksCovered * 7));

      await txnRefDoc.set({
        memberRef: cleanMemberRef,
        memberId: memberId,
        amount: amount,
        level: memberLevel,
        type: "SAVINGS_DEPOSIT",
        weeksCovered: weeksCovered,
        rawMessage: message,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

      await db.collection("members").doc(memberId).update({
        totalSavings: admin.firestore.FieldValue.increment(amount),
        paidUntilDate: newPaidUntil,
        lastSavingsDate: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(200).json({ status: "SUCCESS_SAVINGS_DEPOSIT", amountPaid: amount, weeksCovered });
    }

  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`WPS Server listening on port ${PORT}`));