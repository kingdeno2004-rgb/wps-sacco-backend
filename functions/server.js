const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: '*/*' })); // Catch raw text / plain string payloads from SMS forwarders

// Initialize Firebase Admin with embedded credentials
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: "workingpowersaccol",
      clientEmail: "firebase-adminsdk-fbsvc@workingpowersaccol.iam.gserviceaccount.com",
      privateKey: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDauwF8L4WECaTV\npx8B2KMQtGSFLBxTzp7OO8loOojDUeW5Gtk1i/l/WzqTmC9WlsQkwqOMYBfVSQsn\nyK+SLuaUOF8LbDUDhj/VCUnbeTT4AgaqNHorfBYZ/JlPtyIm4WjQbXxO1nvta4pG\ngze+wQThaGiuxjOrxBZnNHCS0TRC61A/VhhaYIdmqaRKA5cT4pG2QZxlGQ+F8xpe\n5/ynFZEAzC7p7fkxOo3p82kBG6NNUW8z3sYbVr0poKe6x0/wyHRzPtuOce12aIIF\nBSts/jMhJBpJ6jcuVijTaPW1L/xOwdWAE42k0XFLXfVEjV2+XHpqXJTU/1DDcVyu\nTBOizpn1AgMBAAECggEAM2H15dn2CAAJ+GTTjGf7Wou+B2jG2MszlCgIVtNVWGjv\nSc4sU39n44qnVo/MIw+00RvmNq5GOwT3OWfUEsewxAYAEdtgEs1hRmbxsjylfFNh\nhG9ieb+jI4Sq8UaIn9CZAkmOB6ksIKiAKbNej5GhV2BjIxeNgN7GEoWHon3BxKw6\nkNLT4Tz2UJVQLUiUSckDn8/P21cqliLNgNrrpbPGqFB//BAfNgYNQA7joIQSAyBk\nBPviRoeFpq7UYOKfzj/+IAM5O3X3taLgaN/C9AUjoUNj8jGUFgWqEjoguQ5dVG8T\ncnHiOdCJbEznBFI95XGlmuaNnOyK4OrrSGChAUo7AQKBgQDxfV06pF8UqdgZffj9\nGDQDNedBhlRX2PBjCIAHncjOt2IZ5o80+2QJb2eazqOOBvYGgzitctLmaLWKU81r\n6lBCQEkyFOGwjAezUIb7Aoz9Bfdw0LPjP27sbIy0/XN25gJyf0ZZCq+hNEJeZnQF\nJCp38cNED0BOtci1g1ZXtQ5XdQKBgQDn3443rUuK8HBSJJ2irpR8LhG2Mr+68DDG\KLJCqce8Qe3W2PMk2eeGDFk2AkCRu+D0yPX9nScojYM2WW6xTYzd9/k1Q+8dpxlQ\RsKmg13Nv7xGzvav3FmtoBEF+bUdekzeu8W0C7+aQDDTnXgU9KCWK6yN3W4ytU7b\ncSpwcjlogQKBgHEqxp3MmaIdVd/cYOp6hSVcBVt3j977EuvV9+mZz5jP53Er0sCJ\nbn/dbTfmzk6ohHLY256syJihSTHhw8pmq+XgKm0FzB3oAVPO0PKgZ2HLggGkTCia\neWjiFa5bd9ioQU1Wx6jCkTuCOffzGzutjxlWeqNSYliAZ+Zn/fZsKqRhAoGAd1+0\njB1/osweR2vqa/KNJ1FgdPizlL5LnfkdrQxTdCxNEisnInW8qFp7Iz8Nlvmu2tcL\nLcJWgp44SybHwig2uaAMgMu0swNwGNAVLjy7ck2f1KSAhBFhae3aVcU05TQtlw38\nrvrC9t+AMQyXyyHcYpbdeYrr5HMoTCw671qA3xgECgYEA2JqDizHI3z+WcFXGDInK\;Cy/9VLJCaZw2Y6U7lV6+uV774CsxtUxDrgm+gCAn1lmjDIac67qWxrl61fNd7EhV\nY3P96pAINq4i3zvNLVpxtdIy3HiROgTfyFzeAaGa6A3lSgjxW4JxJmZwmMICb37r\n+uKAYcUN8wP+xqKYeS5/tsc=\n-----END PRIVATE KEY-----".replace(/\\n/g, '\n')
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