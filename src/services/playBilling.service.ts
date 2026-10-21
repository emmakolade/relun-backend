import { GoogleAuth } from 'google-auth-library';

/**
 * Checks Google Play purchases with the Android Publisher API: one-time coin
 * products and the Relun Plus subscription.
 *
 * Needs:
 *   ANDROID_PACKAGE_NAME             e.g. com.relun.app
 *   GOOGLE_PLAY_SERVICE_ACCOUNT_PATH path to a service-account JSON key that
 *                                    has access in Play Console > API access
 *
 * Without the key, purchases are rejected unless PLAY_BILLING_ALLOW_UNVERIFIED=true
 * is set outside production, so testing on an emulator still works but a server
 * that forgot NODE_ENV never mints coins for an unchecked token.
 *
 * Verified purchases are acknowledged here too: Google refunds anything left
 * unacknowledged for three days, and a modified app could skip that step to
 * keep the coins and get its money back.
 */

type ProductPurchase = {
  purchaseState?: number; // 0 purchased, 1 cancelled, 2 pending
  consumptionState?: number; // 0 not yet consumed, 1 consumed
  orderId?: string;
  acknowledgementState?: number; // 0 yet to be acknowledged, 1 acknowledged
};

export type VerifyResult = { ok: true; orderId?: string } | { ok: false; reason: string };

let auth: GoogleAuth | null = null;

const getAuth = (): GoogleAuth | null => {
  const keyFile = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PATH;
  if (!keyFile) return null;

  if (!auth) {
    auth = new GoogleAuth({
      keyFile,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
  }

  return auth;
};

const allowUnverified = (): boolean =>
  process.env.NODE_ENV !== 'production' && process.env.PLAY_BILLING_ALLOW_UNVERIFIED === 'true';

const PUBLISHER_API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/';

export const verifyPlayPurchase = async (
  productId: string,
  purchaseToken: string
): Promise<VerifyResult> => {
  const googleAuth = getAuth();
  const packageName = process.env.ANDROID_PACKAGE_NAME || 'com.relun.app';

  if (!googleAuth) {
    if (!allowUnverified()) {
      return { ok: false, reason: 'Purchase verification is not configured' };
    }
    console.warn(
      '[billing] GOOGLE_PLAY_SERVICE_ACCOUNT_PATH not set; accepting unverified purchase'
    );
    return { ok: true };
  }

  try {
    const client = await googleAuth.getClient();
    const url =
      PUBLISHER_API +
      `${encodeURIComponent(packageName)}/purchases/products/${encodeURIComponent(productId)}` +
      `/tokens/${encodeURIComponent(purchaseToken)}`;

    const response = await client.request<ProductPurchase>({ url });
    const purchase = response.data;

    if (purchase.purchaseState !== 0) {
      return { ok: false, reason: 'Purchase is not completed' };
    }

    // The app still consumes it afterwards; consuming works on an acknowledged purchase.
    if (purchase.acknowledgementState === 0 && purchase.consumptionState !== 1) {
      await client.request({ url: `${url}:acknowledge`, method: 'POST', data: {} }).catch((error) => {
        console.error('[billing] Play acknowledge failed:', error);
      });
    }

    return { ok: true, orderId: purchase.orderId };
  } catch (error) {
    console.error('[billing] Play verification failed:', error);
    return { ok: false, reason: 'Could not verify purchase' };
  }
};

type SubscriptionPurchaseV2 = {
  // SUBSCRIPTION_STATE_ACTIVE, _IN_GRACE_PERIOD, _ON_HOLD, _CANCELED, _EXPIRED, ...
  subscriptionState?: string;
  latestOrderId?: string;
  acknowledgementState?: string; // ACKNOWLEDGEMENT_STATE_PENDING, _ACKNOWLEDGED
  lineItems?: {
    productId?: string;
    expiryTime?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
    offerDetails?: { basePlanId?: string };
  }[];
};

export type SubscriptionResult =
  | {
      ok: true;
      // Null only when verification is skipped in development.
      expiry: Date | null;
      productId?: string;
      basePlanId?: string;
      autoRenew: boolean;
      orderId?: string;
    }
  | { ok: false; reason: string };

// States where the subscriber has paid for the current period. A cancelled
// subscription still counts until its expiry.
const PAID_STATES = [
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED',
];

/**
 * Checks a Google Play subscription (Relun Plus) with the subscriptionsv2 API.
 * A cancelled subscription still counts until its expiry; Google keeps the
 * expiry current as it renews.
 */
export const verifyPlaySubscription = async (purchaseToken: string): Promise<SubscriptionResult> => {
  const googleAuth = getAuth();
  const packageName = process.env.ANDROID_PACKAGE_NAME || 'com.relun.app';

  if (!googleAuth) {
    if (!allowUnverified()) {
      return { ok: false, reason: 'Purchase verification is not configured' };
    }
    console.warn('[billing] GOOGLE_PLAY_SERVICE_ACCOUNT_PATH not set; accepting unverified subscription');
    return { ok: true, expiry: null, autoRenew: true };
  }

  try {
    const client = await googleAuth.getClient();
    const url =
      PUBLISHER_API +
      `${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;

    const response = await client.request<SubscriptionPurchaseV2>({ url });
    const sub = response.data;
    const item = sub.lineItems?.[0];
    const expiry = item?.expiryTime ? new Date(item.expiryTime) : null;

    if (!expiry || !item?.productId || !PAID_STATES.includes(sub.subscriptionState ?? '')) {
      return { ok: false, reason: 'Subscription is not active' };
    }

    if (sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
      const ackUrl =
        PUBLISHER_API +
        `${encodeURIComponent(packageName)}/purchases/subscriptions/${encodeURIComponent(item.productId)}` +
        `/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
      await client.request({ url: ackUrl, method: 'POST', data: {} }).catch((error) => {
        console.error('[billing] Play subscription acknowledge failed:', error);
      });
    }

    return {
      ok: true,
      expiry,
      productId: item?.productId,
      basePlanId: item?.offerDetails?.basePlanId,
      autoRenew: item?.autoRenewingPlan?.autoRenewEnabled ?? false,
      orderId: sub.latestOrderId,
    };
  } catch (error) {
    console.error('[billing] Play subscription verification failed:', error);
    return { ok: false, reason: 'Could not verify subscription' };
  }
};
