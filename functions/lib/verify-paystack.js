// functions/lib/verify-paystack.ts

export async function verifyPaystackSignature(
  rawBody: string,
  signature: string,
  secret: string
): Promise<boolean> {
  // 1. Basic validation
  if (!signature) return false;

  // 2. Prepare the data for HMAC
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const bodyData = encoder.encode(rawBody);

  // 3. Import the key for HMAC-SHA512
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );

  // 4. Compute the HMAC signature
  const computedSignatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    bodyData
  );

  // 5. Convert the computed signature to a hex string
  const computedSignature = Array.from(new Uint8Array(computedSignatureBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  // 6. Perform a constant-time comparison to prevent timing attacks
  // The signature from Paystack is a hex string, so we encode both for comparison.
  const encoderForCompare = new TextEncoder();
  const sigA = encoderForCompare.encode(computedSignature);
  const sigB = encoderForCompare.encode(signature);

  // Cloudflare's timingSafeEqual requires buffers of equal length
  if (sigA.byteLength !== sigB.byteLength) {
    return false;
  }

  return crypto.subtle.timingSafeEqual(sigA, sigB);
}