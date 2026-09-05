import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("LINE persistence migration contract", () => {
  it("stores credentials and identities only in encrypted fields and enforces tenant-composite delivery references", async () => {
    const migration = await readFile("prisma/migrations/20260905113000_line_official_account/migration.sql", "utf8");
    for (const encryptedField of [
      "messagingChannelIdEncrypted",
      "messagingChannelSecretEncrypted",
      "messagingAccessTokenEncrypted",
      "lineUserIdEncrypted",
      "payloadEncrypted",
    ]) expect(migration).toContain(`"${encryptedField}"`);
    for (const forbiddenPlaintextField of ['"channelSecret"', '"accessToken"', '"lineUserId"']) {
      expect(migration).not.toContain(forbiddenPlaintextField);
    }
    expect(migration).toContain('FOREIGN KEY ("vendorId", "lineOfficialAccountId") REFERENCES "LineOfficialAccount"("vendorId", "id")');
    expect(migration).toContain('FOREIGN KEY ("vendorId", "lineUserIdentityId") REFERENCES "LineUserIdentity"("vendorId", "id")');
    expect(migration).toContain('FOREIGN KEY ("vendorId", "sourceTemplateId") REFERENCES "MessageTemplate"("vendorId", "id")');
    expect(migration).toContain('CREATE UNIQUE INDEX "LineDelivery_vendorId_idempotencyKey_key"');
  });
});
