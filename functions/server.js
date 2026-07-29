const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: '*/*' })); // Catch raw text / plain string payloads from SMS forwarders

// Initialize Firebase Admin using environment variables to prevent decoding errors
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: "workingpowersaccol",
      clientEmail: "firebase-adminsdk-fbsvc@workingpowersaccol.iam.gserviceaccount.com",
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined
    }),
    databaseURL: "https://workingpowersaccol-default-rtdb.firebaseio.com"
  });
}

const db = admin.firestore();
const rtdb = admin.database();

function getWeeklyTarget(levelNumber) {
  const level = parseInt(levelNumber, 10) || 1;
  return 6000 + (level - 1) * 2500;
}

app.get('/', (req, res) => res.send('WPS SACCO Airtel Webhook Live!'));

app.post('/api/sacco/airtel-webhook', async (req, res) => {
  try {
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

    const amountMatch = message.match(/UGX\s*([\d,]+)/i);
    const amount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, ""), 10) : 0;

    const refMatch = message.match(/(?:reference|rererence)\s*([a-zA-Z0-9\-]+)/i);
    const rawRef = refMatch ? refMatch[1].trim() : "";

    const txnMatch = message.match(/(TID\d+)/i);
    const txnId = txnMatch ? txnMatch[1] : `TXN-${Date.now()}`;

    if (!amount || !rawRef) {
      return res.status(200).json({ status: "IGNORED", reason: "Invalid format", receivedContent: message });
    }

    // Check if transaction already exists in RTDB transactions
    const txnSnap = await rtdb.ref(`transactions_log/${txnId}`).once('value');
    if (txnSnap.exists()) {
      return res.status(200).json({ status: "ALREADY_PROCESSED" });
    }

    const isLoanPayment = rawRef.toUpperCase().includes("LOAN");
    const cleanMemberRef = rawRef.replace(/\bLOAN\b/gi, "").trim();

    // Fetch all members from Realtime Database to perform a flexible search
    const membersSnap = await rtdb.ref('members').once('value');
    if (!membersSnap.exists()) {
      return res.status(404).json({ status: "MEMBER_NOT_FOUND", reason: "No members in RTDB" });
    }

    const membersObj = membersSnap.val();
    let matchedMemberKey = null;
    let memberData = null;

    // Search through RTDB keys and fullNames case-insensitively
    const searchClean = cleanMemberRef.toLowerCase();
    for (const [key, val] of Object.entries(membersObj)) {
      const dbKeyLower = key.toLowerCase();
      const dbNameLower = val.fullName ? val.fullName.toLowerCase() : "";
      
      if (dbKeyLower === searchClean || dbNameLower.includes(searchClean)) {
        matchedMemberKey = key;
        memberData = val;
        break;
      }
    }

    if (!matchedMemberKey) {
      console.log(`Member not found for reference: ${cleanMemberRef}`);
      return res.status(404).json({ status: "MEMBER_NOT_FOUND", searched: cleanMemberRef });
    }

    const rtdbMemberRef = rtdb.ref(`members/${matchedMemberKey}`);

    if (isLoanPayment) {
      const currentLoanBalance = memberData.toPay !== undefined ? memberData.toPay : (memberData.outstandingLoanBalance || 0);
      const newLoanBalance = Math.max(0, currentLoanBalance - amount);

      // Log transaction
      await rtdb.ref(`transactions_log/${txnId}`).set({
        memberRef: cleanMemberRef,
        memberKey: matchedMemberKey,
        amount: amount,
        type: "LOAN_REPAYMENT",
        previousBalance: currentLoanBalance,
        newBalance: newLoanBalance,
        rawMessage: message,
        timestamp: Date.now()
      });

      await rtdbMemberRef.update({
        toPay: newLoanBalance,
        lastActivity: `LOAN_PAY (Auto) on ${new Date().toLocaleDateString()}`,
        lastActivityDate: new Date().toISOString()
      });

      await rtdb.ref(`transactions/${matchedMemberKey}`).push({
        type: 'LOAN_PAY',
        amount: amount,
        date: new Date().toLocaleString()
      });

      return res.status(200).json({ status: "SUCCESS_LOAN_REPAYMENT", member: matchedMemberKey, amountPaid: amount, newLoanBalance });
    } else {
      const memberLevel = memberData.level || 1;
      const weeklyTarget = getWeeklyTarget(memberLevel);
      const weeksCovered = Math.floor(amount / weeklyTarget);

      const currentSavings = memberData.savings || 0;
      const newTotalSavings = currentSavings + amount;

      await rtdb.ref(`transactions_log/${txnId}`).set({
        memberRef: cleanMemberRef,
        memberKey: matchedMemberKey,
        amount: amount,
        level: memberLevel,
        type: "SAVINGS_DEPOSIT",
        weeksCovered: weeksCovered,
        rawMessage: message,
        timestamp: Date.now()
      });

      await rtdbMemberRef.update({
        savings: newTotalSavings,
        lastActivity: `SAV_CUSTOM (Auto) on ${new Date().toLocaleDateString()}`,
        lastActivityDate: new Date().toISOString()
      });

      await rtdb.ref(`transactions/${matchedMemberKey}`).push({
        type: 'SAV_CUSTOM',
        amount: amount,
        date: new Date().toLocaleString()
      });

      return res.status(200).json({ status: "SUCCESS_SAVINGS_DEPOSIT", member: matchedMemberKey, amountPaid: amount, weeksCovered });
    }

  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`WPS Server listening on port ${PORT}`));