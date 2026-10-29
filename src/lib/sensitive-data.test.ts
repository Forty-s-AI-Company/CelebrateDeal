import { createCipheriv, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DERIVED_KEY_ROTATIONS } from "@/lib/derived-key-rotation";
import { decryptSensitiveValue, deriveSensitiveDataKey, encryptSensitiveValue } from "@/lib/sensitive-data";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sensitive data envelopes", () => {
  it("encrypts values without retaining plaintext and decrypts only for the same purpose", () => {
    vi.stubEnv("CSRF_SECRET", "test-csrf-secret-for-sensitive-data-32-bytes");
    const plaintext = "cloudflare-stream-key-fixture";
    const envelope = encryptSensitiveValue(plaintext, "cloudflare-live-stream-key");

    expect(envelope).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(envelope).not.toContain(plaintext);
    expect(decryptSensitiveValue(envelope, "cloudflare-live-stream-key")).toBe(plaintext);
    expect(() => decryptSensitiveValue(envelope, "another-purpose")).toThrow();
  });

  it("accepts only full 16-byte GCM tags (truncated tags are refused before decrypting)", () => {
    vi.stubEnv("CSRF_SECRET", "test-csrf-secret-for-sensitive-data-32-bytes");
    const purpose = "cloudflare-live-stream-key";
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", deriveSensitiveDataKey(purpose), iv, { authTagLength: 4 });
    const encrypted = Buffer.concat([cipher.update("secret", "utf8"), cipher.final()]);
    // A valid envelope under a 4-byte tag: Node would accept it without authTagLength.
    const shortTag = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
    expect(() => decryptSensitiveValue(shortTag, purpose)).toThrow("Invalid sensitive data envelope.");

    const [version, ivPart, tagPart, data] = encryptSensitiveValue("secret", purpose).split(".");
    const truncated = Buffer.from(tagPart!, "base64url").subarray(0, 12).toString("base64url");
    expect(() => decryptSensitiveValue([version, ivPart, truncated, data].join("."), purpose)).toThrow("Invalid sensitive data envelope.");
    expect(decryptSensitiveValue([version, ivPart, tagPart, data].join("."), purpose)).toBe("secret");
  });

  it("fails closed when the configured encryption seed is shorter than 32 bytes", () => {
    vi.stubEnv("CSRF_SECRET", "short-secret");
    vi.stubEnv("JOB_SECRET", "");

    expect(() => encryptSensitiveValue("secret", "cloudflare-live-stream-key")).toThrow(
      "Sensitive data encryption key is too short.",
    );
  });

  it("fails closed when no server-side encryption key is configured", () => {
    vi.stubEnv("CSRF_SECRET", "");
    vi.stubEnv("JOB_SECRET", "");

    expect(() => encryptSensitiveValue("secret", "cloudflare-live-stream-key")).toThrow(
      "Sensitive data encryption key is not configured.",
    );
  });
});

describe("deriveSensitiveDataKey compatibility", () => {
  // Golden values were produced by the implementation before the CSRF key
  // separation fix, using only this synthetic root secret. If any of them
  // changes, existing MFA secrets, PII envelopes and hash indexes stop working.
  const SYNTHETIC_ROOT_SECRET = "synthetic-kdf-golden-root-secret-0123456789";
  const GOLDEN_KEYS: ReadonlyArray<readonly [string, string]> = [
    ["mfa-encryption", "a2eb7246cc071f0b207ed88782eb2eda683c45a500267425d62c8350ba06d014"],
    ["mfa-recovery-code-authentication", "bad8df85f6bab6524967cb00394d22ee4567a83f8382f4583abbab115cdb0c33"],
    ["commerce-order-buyer", "0b9390349e18235d3eb6a08d2b3e0d011f49f221309c6d8c5f968cd2f793ea42"],
    ["commerce-order-identity-fingerprint", "2b9d652b48836d4fa54f7b4a8a158818bb00794e98b4ff5b5ac738a48ca948e6"],
    ["form-submission-email-verification", "b3b44c1ecfa43cb42104334ce8a72cc3e47a2a58a530ed111ec77c8e27b27354"],
    ["form-submission-chat-session", "c5a2007a6a71a05f278a000ad85e0f279da974d337840d1accab4dd8629975b3"],
    ["email-delivery-unsubscribe", "f2dc0610274f5e683dd87b27f5d2a129a5af214c4546fc3ee4e0d8320afe8204"],
    ["student-portal-access-token-v1", "3ea4439b0cf0d30da405ee3da4da247e4a198c273335dec86d69cafc87168338"],
    ["cloudflare-live-stream-key", "2ba1c55eb1f9ff72d33ce306a6b11006e4fc943698d50b2dd2ed9a2c9d4f4328"],
    ["line-user-lookup:vendor_1", "3945fa3caa06c4c8d1019b8909077315181591182f5f6d2599e78c8aaa203a63"],
    ["team-funnel-attribution-cookie", "fd844965ebae71c2d9cbae99dae5413942357b5471f11e7a6bb4b32968c7450c"],
    ["public-checkout-admission", "23ab20a36125cd00c78d464aa9a06fc0cdcdc59c333ad3616567cbeb7bd79b78"],
    ["merchant-registration-invite", "a1aa5eb2c893bc38e1efe443a2842721b2c8baaffa780b202df37d1325768d92"],
    ["merchant-registration-invite-v2", "9e2ff4671f0dd4759a0905a0d9bfdbc1a9fa1b8dcb41fa8571f404f2e71ed9cf"],
    // Legacy purposes that B04-03 rotation still reads (derived-key-purposes.ts).
    ["form-submission-line-binding", "7ed8eaba8b3fd6cc11cb2695500fc35fd21dbf669532b2ebf7d8ea52d5335157"],
    ["live-viewer-pass", "3763e8220397c1ad3744e980193bfb652b97931a37f041204b0816e1e7112f66"],
    ["live-chat-cursor", "93bf7f10c14e3650e9b0b28b83aab87d9afe4a82a57e961c9eb20f0f129f86ef"],
    ["post-purchase-checkout", "5efa34f2bd169310c70749133dacbfdfbcd5819f0031d2a8ec8fa16005500b46"],
    ["registration-submission-result-v1", "3afaa429fe82ed26ee4c3fd94fc357c11d2945a9af90d862997b3a42089da5c7"],
    ["automation-voucher-bearer-v1", "5ec9a6b5f017904c83bfedf76596e566962df6d6a38ce420f73a3f1d50c30960"],
    ["student-portal-session-v1", "a7a4c85a8a70cfeef17bc1d1c49f002e54f9ca13d7b97819eefd6cbc57d998dd"],
    ["cloudflare-resumable-upload-ticket", "84e5bd219d8c6c3481aefee24fb2fc69730ecd35202e5b71688ed537fd7215c3"],
  ];

  // Rotated purposes (B04-03). Locked too, so a later edit of a suffix cannot
  // silently orphan every token or MFA secret written under it.
  const ROTATED_GOLDEN_KEYS: ReadonlyArray<readonly [string, string]> = [
    ["public-checkout-admission:r2:9840cc8be0dee028", "33e899a03509b8681b59d9be965a583bee2f9cbc846d511d464e4a863e102e55"],
    ["form-submission-line-binding:r2:23b7ba098c10746d", "d6087ec80322f5a76de626b0fafa99ad31cb3abc6f55a3fed40f7acafabb756d"],
    ["student-portal-access-token:r2:5774306767daa6bc", "785aea53cc9289601b4f94f7f06b8328500a33c9e804c47ff5661d897b0e9562"],
    ["live-viewer-pass:r2:75b99acaa88645c2", "b69428a85aba4e78c80460676a35e37172ede1fc075a200e1bd4cdd6ef700494"],
    ["live-chat-cursor:r2:98430ee0e284cf26", "adc8b5eadff45ebe98c0ce998bc4d5ede0e927f8d9ed83d3f7daa00970a684e2"],
    ["live-private-chat-cursor:r2:408078b5f163410f", "b000893a07c7d7616075614ac3bb7cd033ef6630f070b2796823650502333740"],
    ["post-purchase-checkout:r2:9fc775dc50019fcd", "bd3569eadc151cba6dbffeba263121a4fd79a114f697e406bfd186914cac868d"],
    ["registration-submission-result:r2:15cdb4621848305d", "63c2f6e5e6017bd99e34b2cae70f8c893c2b9579420f32824409af2f433f3e8b"],
    ["email-delivery-unsubscribe:r2:fba6e90ffca21a4b", "365cd739bc54053a25b698a0e3a910b372cfe64357ad983e196b98276bd25ea1"],
    ["form-submission-email-verification:r2:e395f0f75e344e9c", "c12568aae2c9de88f376243dc8f38366dcbfed040d15d987b55c7554de258484"],
    ["form-submission-chat-session:r2:070a4f7ffaff8f24", "8085d3a2ee8ea6a6d2c3404d08693152c6f6ccef40d832bd1aa4bf5d271680cd"],
    ["team-funnel-attribution-cookie:r2:e4c8b499bd4d6282", "718c8d1a6d0ef27b699ab8e2f29fab5086b74fabd51ec7901cc3f8f1b6da468b"],
    ["automation-voucher-bearer:r2:b11cbe79110dc467", "ebdada6bed144029c1659e617d44cb09ce548064c64972ed5091ee80998c9d3e"],
    ["student-portal-session:r2:710e5987327ae525", "9cae1023a5cf6bb75e98cd047d44d4caa12fdd33fdd14e30bdb89b1303ec90da"],
    ["cloudflare-resumable-upload-ticket:r2:615079db018ccd08", "29626a3be676f85fc8c5b4dede13877a30c4dbde04bcef0d2576e2b21bc82194"],
    ["mfa-encryption:r2:69a113bdb66c7a1e", "254be5b83aa252e7bf87d31f5795eaf50fce89b1f1d0738751555359f3f97666"],
    ["mfa-recovery-code-authentication:r2:0d054e31e6b4e6a2", "34b2790668c742ab520969114247b2d30a9e56083dce1ab7f14b35a2269520fb"],
    ["csrf-hmac:r2:db862e72a7b9a462", "097167103f585faebe8ad2d1972b3bdd9561a4df648160050db8527da34e60c4"],
    ["merchant-registration-invite:r2:9ecb5a622edbf327", "037c93c337f506df35369ee565130db93da60a28b13561e883ecc63950ef30ee"],
    ["merchant-email-verification:r2:5a881e5879ba6156", "47636dcbd0645d5f0cb4b0256d9e88ebaa23e67838263bc755f070eda927b9c8"],
    ["account-email-change:r2:a8a788e3ba38de72", "2feb0b738fee9812061467f65792776873cdd5d5d93279e9a5c0955f7a0d83fa"],
    ["merchant-invite-email:r2:bcaa6cb59eb97af3", "40d60f1b71e1c9d7f0b61384c6749b49b404356c08691d5966edd9bb693eddaf"],
    ["live-private-chat-conversation-binding:r2:93e8e3400ce0da2b", "f3564cae76a1e8fed03f3690bfb5bed2946203db0b3e658df496845c88ab6971"],
    ["evergreen-viewer-session:r2:755cb80211ac7475", "5b95497914adb4bce99a9d40f20fe7e5114e196f22b77fbf519166e5bc809ce8"],
  ];

  it.each(GOLDEN_KEYS)("keeps the %s key byte-identical", (purpose, expectedHex) => {
    vi.stubEnv("CSRF_SECRET", SYNTHETIC_ROOT_SECRET);

    expect(deriveSensitiveDataKey(purpose).toString("hex")).toBe(expectedHex);
  });

  it.each(ROTATED_GOLDEN_KEYS)("keeps the rotated %s key byte-identical", (purpose, expectedHex) => {
    vi.stubEnv("CSRF_SECRET", SYNTHETIC_ROOT_SECRET);

    expect(deriveSensitiveDataKey(purpose).toString("hex")).toBe(expectedHex);
  });

  it("locks every rotation's current and legacy purpose", () => {
    const golden = new Map([...GOLDEN_KEYS, ...ROTATED_GOLDEN_KEYS]);
    for (const rotation of Object.values(DERIVED_KEY_ROTATIONS)) {
      expect(golden.has(rotation.current), rotation.current).toBe(true);
      if (rotation.legacy) expect(golden.has(rotation.legacy.purpose), rotation.legacy.purpose).toBe(true);
    }
  });

  it("keeps the JOB_SECRET fallback root unchanged when CSRF_SECRET is absent", () => {
    vi.stubEnv("CSRF_SECRET", "");
    vi.stubEnv("JOB_SECRET", SYNTHETIC_ROOT_SECRET);

    expect(deriveSensitiveDataKey("mfa-encryption").toString("hex")).toBe(GOLDEN_KEYS[0][1]);
  });
});
