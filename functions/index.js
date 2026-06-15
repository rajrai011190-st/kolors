/**
 * The Kolours — Stripe card checkout (Firebase Cloud Functions, Gen 2).
 *
 * Two HTTPS functions:
 *   createCheckoutSession  — builds a Stripe Checkout session for the cart and
 *                            returns its hosted card-page URL. Prices are read
 *                            from Firestore (never trusted from the client) so
 *                            amounts can't be tampered with.
 *   stripeWebhook          — Stripe calls this after payment; records the order
 *                            and marks the purchased paintings as sold.
 *
 * Secrets (set via `firebase functions:secrets:set` or the params UI):
 *   STRIPE_SECRET_KEY        — sk_test_… then sk_live_…
 *   STRIPE_WEBHOOK_SECRET    — whsec_… from the Stripe webhook endpoint
 */

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const Stripe = require("stripe");

admin.initializeApp();
const db = admin.firestore();

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

// Public site origin(s) allowed to call the checkout function.
const ALLOWED_ORIGINS = [
  "https://thekolours.com",
  "https://www.thekolours.com",
  "https://rajrai011190-st.github.io",
  // Capacitor native app webview origins (iOS uses capacitor://, Android https://localhost).
  "capacitor://localhost",
  "https://localhost",
];
const SITE_URL = "https://thekolours.com";

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Verify the Firebase ID token sent as "Authorization: Bearer <token>".
// Returns the decoded token (with .uid/.email) or null if missing/invalid.
async function requireUser(req) {
  const header = req.headers.authorization || "";
  const m = header.match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    return await admin.auth().verifyIdToken(m[1]);
  } catch (err) {
    return null;
  }
}

// Platform commission (%). Configurable via siteContent/main.commissionPct.
const DEFAULT_COMMISSION_PCT = 20;
async function getCommissionPct() {
  try {
    const snap = await db.collection("siteContent").doc("main").get();
    const v = snap.exists ? Number(snap.data().commissionPct) : NaN;
    if (isFinite(v) && v >= 0 && v < 100) return v;
  } catch (err) {
    logger.warn("Could not read commissionPct; using default", err);
  }
  return DEFAULT_COMMISSION_PCT;
}

/**
 * POST { items: [{ id }] }  ->  { url }
 * Server looks up each painting, trusts ONLY the Firestore price/availability.
 */
exports.createCheckoutSession = onRequest(
  { secrets: [STRIPE_SECRET_KEY], region: "us-central1", invoker: "public" },
  async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
      const stripe = new Stripe(STRIPE_SECRET_KEY.value());
      const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
      if (!items.length) return res.status(400).json({ error: "Cart is empty." });

      const ids = [...new Set(items.map((it) => String(it && it.id)).filter(Boolean))];
      const lineItems = [];
      const purchasedIds = [];

      for (const id of ids) {
        const snap = await db.collection("paintings").doc(id).get();
        if (!snap.exists) continue;
        const p = snap.data();
        if (p.available === false) continue; // already sold — skip silently
        const price = Number(p.price);
        if (!isFinite(price) || price <= 0) continue;

        const product = { name: String(p.title || "Untitled") };
        if (typeof p.img === "string" && /^https:\/\//i.test(p.img)) {
          product.images = [p.img];
        }
        if (p.artist) product.description = `by ${p.artist}`;

        lineItems.push({
          price_data: {
            currency: "cad",
            unit_amount: Math.round(price * 100),
            product_data: product,
          },
          quantity: 1, // one-of-a-kind originals
        });
        purchasedIds.push(id);
      }

      if (!lineItems.length) {
        return res.status(409).json({ error: "These items are no longer available." });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: lineItems,
        success_url: `${SITE_URL}/?paid={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/?canceled=1`,
        shipping_address_collection: { allowed_countries: ["CA"] },
        phone_number_collection: { enabled: true },
        metadata: { paintingIds: purchasedIds.join(",") },
      });

      return res.status(200).json({ url: session.url });
    } catch (err) {
      logger.error("createCheckoutSession failed", err);
      return res.status(500).json({ error: "Could not start checkout. Please try again." });
    }
  }
);

/**
 * POST (auth required) -> { url }
 * Creates (or reuses) the caller's Stripe Express connected account and returns
 * a Stripe-hosted onboarding link. An artist can only set up their own account.
 */
exports.createConnectAccountLink = onRequest(
  { secrets: [STRIPE_SECRET_KEY], region: "us-central1", invoker: "public" },
  async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
      const decoded = await requireUser(req);
      if (!decoded) return res.status(401).json({ error: "Sign in required." });

      const stripe = new Stripe(STRIPE_SECRET_KEY.value());
      const uid = decoded.uid;
      const userRef = db.collection("users").doc(uid);
      const userSnap = await userRef.get();
      const user = userSnap.exists ? userSnap.data() : {};

      let accountId = user.stripeAccountId;
      if (!accountId) {
        const account = await stripe.accounts.create({
          type: "express",
          country: "CA",
          email: decoded.email || undefined,
          business_type: "individual",
          capabilities: { transfers: { requested: true } },
          metadata: { uid, artistId: user.artistId || uid },
        });
        accountId = account.id;
        await userRef.set({ stripeAccountId: accountId }, { merge: true });
      }

      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${SITE_URL}/?connect=refresh`,
        return_url: `${SITE_URL}/?connect=done`,
        type: "account_onboarding",
      });

      return res.status(200).json({ url: link.url });
    } catch (err) {
      logger.error("createConnectAccountLink failed", err);
      return res.status(500).json({ error: "Could not start payout setup. Please try again." });
    }
  }
);

/**
 * POST (auth required) -> { connected, payoutsEnabled, detailsSubmitted }
 * Fetches the caller's Connect account status from Stripe and mirrors it onto
 * their users doc. Called by the Studio after the artist returns from onboarding.
 */
exports.getConnectStatus = onRequest(
  { secrets: [STRIPE_SECRET_KEY], region: "us-central1", invoker: "public" },
  async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");

    try {
      const decoded = await requireUser(req);
      if (!decoded) return res.status(401).json({ error: "Sign in required." });

      const userRef = db.collection("users").doc(decoded.uid);
      const userSnap = await userRef.get();
      const accountId = userSnap.exists ? userSnap.data().stripeAccountId : null;
      if (!accountId) {
        return res.status(200).json({ connected: false, payoutsEnabled: false, detailsSubmitted: false });
      }

      const stripe = new Stripe(STRIPE_SECRET_KEY.value());
      const account = await stripe.accounts.retrieve(accountId);
      const payoutsEnabled = !!account.payouts_enabled;
      const detailsSubmitted = !!account.details_submitted;
      await userRef.set({ payoutsEnabled, detailsSubmitted }, { merge: true });

      return res.status(200).json({ connected: true, payoutsEnabled, detailsSubmitted });
    } catch (err) {
      logger.error("getConnectStatus failed", err);
      return res.status(500).json({ error: "Could not fetch payout status." });
    }
  }
);

/**
 * Creates one Stripe transfer per purchased painting, paying each artist their
 * share (price minus platform commission). Uses "separate charges and transfers"
 * because a single cart can contain paintings from multiple artists. Records a
 * payouts doc per painting (id `${sessionId}_${paintingId}`) for idempotency and
 * admin/artist reporting. Artists without a payouts-enabled account get a
 * "pending" payout that is swept later by the account.updated handler.
 */
async function createTransfersForSession(stripe, session) {
  const ids = String((session.metadata && session.metadata.paintingIds) || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) return;

  const commissionPct = await getCommissionPct();

  // Tie transfers to the originating charge so they don't need a settled balance.
  let chargeId = null;
  try {
    if (session.payment_intent) {
      const pi = await stripe.paymentIntents.retrieve(String(session.payment_intent));
      chargeId = pi.latest_charge || null;
    }
  } catch (err) {
    logger.warn("Could not retrieve payment intent for transfers", err);
  }

  for (const paintingId of ids) {
    const payoutRef = db.collection("payouts").doc(`${session.id}_${paintingId}`);
    const existing = await payoutRef.get();
    if (existing.exists && existing.data().transferId) continue; // already paid

    const pSnap = await db.collection("paintings").doc(paintingId).get();
    if (!pSnap.exists) continue;
    const p = pSnap.data();
    const price = Number(p.price);
    if (!isFinite(price) || price <= 0) continue;

    const gross = Math.round(price * 100);
    const commissionAmount = Math.round(gross * (commissionPct / 100));
    const net = gross - commissionAmount;

    let artistAccountId = null;
    let payoutsEnabled = false;
    if (p.artistId) {
      const uq = await db.collection("users").where("artistId", "==", p.artistId).limit(1).get();
      if (!uq.empty) {
        const u = uq.docs[0].data();
        artistAccountId = u.stripeAccountId || null;
        payoutsEnabled = !!u.payoutsEnabled;
      }
    }

    const base = {
      orderId: session.id,
      paintingId,
      artistId: p.artistId || null,
      artistName: p.artist || null,
      grossAmount: gross,
      commissionAmount,
      netAmount: net,
      commissionPct,
      currency: "cad",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!existing.exists) base.createdAt = admin.firestore.FieldValue.serverTimestamp();

    if (artistAccountId && payoutsEnabled && net > 0) {
      try {
        const transfer = await stripe.transfers.create(
          {
            amount: net,
            currency: "cad",
            destination: artistAccountId,
            transfer_group: session.id,
            metadata: { paintingId, orderId: session.id },
            ...(chargeId ? { source_transaction: chargeId } : {}),
          },
          { idempotencyKey: `tr_${session.id}_${paintingId}` }
        );
        await payoutRef.set(
          { ...base, status: "paid", transferId: transfer.id, paidAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
      } catch (err) {
        logger.error(`Transfer failed for painting ${paintingId}`, err);
        await payoutRef.set({ ...base, status: "failed" }, { merge: true });
      }
    } else {
      await payoutRef.set({ ...base, status: "pending" }, { merge: true });
    }
  }
}

/**
 * Pays out an artist's previously "pending" payouts once their account becomes
 * payouts-enabled (e.g. they connected after a sale already happened).
 */
async function sweepPendingPayouts(stripe, accountId, artistId) {
  if (!artistId) return;
  const q = await db
    .collection("payouts")
    .where("artistId", "==", artistId)
    .where("status", "==", "pending")
    .get();
  for (const doc of q.docs) {
    const d = doc.data();
    const net = Number(d.netAmount);
    if (!isFinite(net) || net <= 0) continue;
    try {
      const transfer = await stripe.transfers.create(
        {
          amount: net,
          currency: d.currency || "cad",
          destination: accountId,
          transfer_group: d.orderId,
          metadata: { paintingId: d.paintingId, orderId: d.orderId },
        },
        { idempotencyKey: `tr_${d.orderId}_${d.paintingId}` }
      );
      await doc.ref.set(
        { status: "paid", transferId: transfer.id, paidAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    } catch (err) {
      logger.error(`Sweep transfer failed for payout ${doc.id}`, err);
    }
  }
}

/**
 * Stripe -> us. Verifies the signature, records the order, marks items sold.
 */
exports.stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET], region: "us-central1", invoker: "public" },
  async (req, res) => {
    const stripe = new Stripe(STRIPE_SECRET_KEY.value());
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        req.headers["stripe-signature"],
        STRIPE_WEBHOOK_SECRET.value()
      );
    } catch (err) {
      logger.error("Webhook signature verification failed", err);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const ids = String((session.metadata && session.metadata.paintingIds) || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      try {
        await db.collection("orders").doc(session.id).set({
          sessionId: session.id,
          paintingIds: ids,
          amountTotal: session.amount_total,
          currency: session.currency,
          email: (session.customer_details && session.customer_details.email) || null,
          name: (session.customer_details && session.customer_details.name) || null,
          phone: (session.customer_details && session.customer_details.phone) || null,
          shipping: session.shipping_details || null,
          paymentStatus: session.payment_status,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        const batch = db.batch();
        for (const id of ids) {
          batch.update(db.collection("paintings").doc(id), {
            available: false,
            badge: "sold",
          });
        }
        await batch.commit();
        logger.info(`Order ${session.id} recorded; ${ids.length} item(s) marked sold.`);

        // Pay each artist their share (full charge -> per-artist transfers).
        await createTransfersForSession(stripe, session);
      } catch (err) {
        logger.error("Failed to record order / mark sold", err);
        return res.status(500).send("Order processing failed");
      }
    }

    if (event.type === "account.updated") {
      const account = event.data.object;
      const accountId = account.id;
      const payoutsEnabled = !!account.payouts_enabled;
      const detailsSubmitted = !!account.details_submitted;
      try {
        const uq = await db
          .collection("users")
          .where("stripeAccountId", "==", accountId)
          .limit(1)
          .get();
        if (!uq.empty) {
          const userDoc = uq.docs[0];
          const wasEnabled = !!userDoc.data().payoutsEnabled;
          await userDoc.ref.set({ payoutsEnabled, detailsSubmitted }, { merge: true });
          // Newly enabled -> pay out anything that was waiting on this artist.
          if (payoutsEnabled && !wasEnabled) {
            await sweepPendingPayouts(stripe, accountId, userDoc.data().artistId);
          }
        }
      } catch (err) {
        logger.error("account.updated handling failed", err);
      }
    }

    return res.status(200).json({ received: true });
  }
);
