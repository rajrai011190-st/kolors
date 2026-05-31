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
];
const SITE_URL = "https://thekolours.com";

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
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
      } catch (err) {
        logger.error("Failed to record order / mark sold", err);
        return res.status(500).send("Order processing failed");
      }
    }

    return res.status(200).json({ received: true });
  }
);
