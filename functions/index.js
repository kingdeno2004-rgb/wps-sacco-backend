const functions = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Calculate required Weekly savings target based on Level V
function getWeeklyTarget(levelNumber) {
  const level = parseInt(levelNumber, 10) || 1;
  return 6000 + (level - 1) * 2500;
}

exports.airtelWebhook = functions.https.onRequest(async (req, res) => {
  try {
    const message = req.body.message || req.body.text || req.body.content || "";
    console.log("Raw Airtel SMS received:", message);

    // 1. Extract Payment Amount (e.g., "UGX 10,000" or "UGX 54,000")
    const amountMatch = message.match(/UGX\s*([\d,]+)/i);
    const amount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, ""), 10) : 0;

    // 2. Extract Raw Reference Text (e.g., "WPS-101 LOAN", "DENNIS LOAN", or "WPS-101")
    const refMatch = message.match(/(?:Ref|Reference)[:\s]*([A-Z0-9-\s]+?)(?=\.\s*Txn|\.\s*ID|$)/i);
    const rawRef = refMatch ? refMatch[1].trim().toUpperCase() : "";

    // 3. Extract Txn ID
    const txnMatch = message.match(/(?:Txn ID|Transaction ID|ID)[:\s]*([A-Z0-9]+)/i);
    const txnId = txnMatch ? txnMatch[1] : `TXN-${Date.now()}`;

    if (!amount || !rawRef) {
      console.log("Ignored: Missing valid amount or reference text.");
      return res.status(200).send({ status: "IGNORED", reason: "Invalid format" });
    }

    // Prevent duplicate processing
    const txnRefDoc = db.collection("transactions").doc(txnId);
    const doc = await txnRefDoc.get();
    if (doc.exists) {
      return res.status(200).send({ status: "ALREADY_PROCESSED" });
    }

    // 4. DETECT TRANSACTION TYPE (Is it a Loan Repayment or Savings?)
    const isLoanPayment = rawRef.includes("LOAN");
    
    // Clean reference to extract the core Member ID / Name (e.g., "WPS-101 LOAN" -> "WPS-101")
    const cleanMemberRef = rawRef.replace(/\bLOAN\b/g, "").trim();

    // 5. Find Member in Firestore
    // Searches by memberRef (e.g. WPS-101) or member name if typed
    let memberQuery = await db.collection("members").where("memberRef", "==", cleanMemberRef).get();

    if (memberQuery.empty) {
      // Fallback search by Name if memberRef wasn't used
      memberQuery = await db.collection("members").where("name", "==", cleanMemberRef).get();
    }

    if (memberQuery.empty) {
      console.log(`Member '${cleanMemberRef}' not found in database.`);
      return res.status(404).send({ status: "MEMBER_NOT_FOUND" });
    }

    const memberDoc = memberQuery.docs[0];
    const memberId = memberDoc.id;
    const memberData = memberDoc.data();

    // ============================================================
    // CASE A: LOAN REPAYMENT (Partial or Full)
    // ============================================================
    if (isLoanPayment) {
      const currentLoanBalance = memberData.outstandingLoanBalance || 0;
      const newLoanBalance = Math.max(0, currentLoanBalance - amount);

      // Save transaction log
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

      // Deduct from Member's outstanding loan balance
      await db.collection("members").doc(memberId).update({
        outstandingLoanBalance: newLoanBalance,
        lastLoanPaymentDate: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`✅ [LOAN REPAYMENT]: ${cleanMemberRef} paid ${amount} UGX towards loan. New loan balance: ${newLoanBalance} UGX`);

      return res.status(200).send({
        status: "SUCCESS_LOAN_REPAYMENT",
        amountPaid: amount,
        remainingLoanBalance: newLoanBalance
      });
    }

    // ============================================================
    // CASE B: SAVINGS DEPOSIT (Tiered V1 - V7)
    // ============================================================
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

      // Save transaction log
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

      // Credit member's total savings and advance coverage date
      await db.collection("members").doc(memberId).update({
        totalSavings: admin.firestore.FieldValue.increment(amount),
        paidUntilDate: newPaidUntil,
        lastSavingsDate: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`✅ [SAVINGS DEPOSIT]: ${cleanMemberRef} (Level V${memberLevel}) deposited ${amount} UGX. Covered ${weeksCovered} weeks.`);

      return res.status(200).send({
        status: "SUCCESS_SAVINGS_DEPOSIT",
        amountPaid: amount,
        weeksCovered,
        paidUntil: newPaidUntil
      });
    }

  } catch (error) {
    console.error("Airtel Webhook Error:", error);
    return res.status(500).send({ error: error.message });
  }
});