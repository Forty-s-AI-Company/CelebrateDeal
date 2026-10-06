import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ email: vi.fn(), push: vi.fn(), fetch: vi.fn() }));
vi.mock("./email", async original => ({ ...await original<typeof import("./email")>(), sendTransactionalEmail: mocks.email }));
vi.mock("web-push", () => ({ default: { sendNotification: mocks.push } }));
import { LearnerPushDestination, sendLearnerNotificationProvider, type NotificationProviderConfiguration } from "./learner-notification-providers";
import { TransactionalEmailError } from "./email";
const base = { channel: "sms" as const, destination: { phone: "+886900000001" }, message: { title: "Synthetic", body: "Synthetic only", path: "/portal/synthetic/learn/course" }, appOrigin: "https://app.example.test", idempotencyKey: "a".repeat(64) };
const config: NotificationProviderConfiguration = { sms: { accountSid: `AC${"0".repeat(32)}`, authToken: "synthetic-test-credential", from: "+15005550006" }, whatsapp: { version: "v22.0", phoneNumberId: "100000000000000", accessToken: "synthetic-test-credential", templateName: "synthetic_notification", language: "zh_TW" }, email: { enabled: true }, push: { subject: "mailto:synthetic@invalid.example", publicKey: "synthetic-public", privateKey: "synthetic-private" } };
const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/synthetic", keys: { p256dh: "a".repeat(87), auth: "a".repeat(22) } };
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch",mocks.fetch); });
afterEach(() => vi.unstubAllGlobals());
it.each(["email","push","sms","whatsapp"] as const)("missing %s configuration never sends or reports success", async channel => {
 const destination = channel === "email" ? { email: "synthetic@invalid.example" } : channel === "push" ? subscription : base.destination;
 expect(await sendLearnerNotificationProvider({ ...base, channel, destination },{})).toEqual({ outcome: "not_delivered", code: "CONFIGURATION" });
 expect(mocks.fetch).not.toHaveBeenCalled();expect(mocks.email).not.toHaveBeenCalled();expect(mocks.push).not.toHaveBeenCalled();
});
it("constructs fixed Twilio form with a bounded timeout and rejects redirects", async () => {
 mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ sid: `SM${"0".repeat(32)}` }),{ status: 201 }));
 expect(await sendLearnerNotificationProvider(base,config)).toEqual({ outcome: "sent", providerReceipt: `SM${"0".repeat(32)}` });
 const [url,options] = mocks.fetch.mock.calls[0]!;
 expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/AC${"0".repeat(32)}/Messages.json`);
 expect(options.redirect).toBe("error");expect(options.signal).toBeInstanceOf(AbortSignal);
 expect(new URLSearchParams(options.body).get("To")).toBe(base.destination.phone);
 expect(new URLSearchParams(options.body).get("Body")).toContain("https://app.example.test/portal/synthetic/learn/course");
});
it("sends only configured WhatsApp template and normalized recipient", async () => {
 mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ messages:[{ id:"wamid.synthetic" }] }),{ status:200 }));
 expect(await sendLearnerNotificationProvider({ ...base,channel:"whatsapp" },config)).toEqual({ outcome:"sent",providerReceipt:"wamid.synthetic" });
 const [url,options] = mocks.fetch.mock.calls[0]!;expect(url).toBe("https://graph.facebook.com/v22.0/100000000000000/messages");
 const body=JSON.parse(options.body);expect(body).toMatchObject({ messaging_product:"whatsapp",to:"886900000001",type:"template",template:{name:"synthetic_notification",language:{code:"zh_TW"}} });
 expect(body.template.components[0].parameters[0].type).toBe("text");
});
it.each([400,401,429])("explicit HTTP %s rejection is not delivery", async status => {
 mocks.fetch.mockResolvedValue(new Response("provider-private-body",{status}));
 expect(await sendLearnerNotificationProvider(base,config)).toEqual({outcome:"not_delivered",code:"REJECTED"});
});
it.each([500,502,503])("ambiguous HTTP %s cannot trigger automatic retry", async status => {
 mocks.fetch.mockResolvedValue(new Response("provider-private-body",{status}));
 expect(await sendLearnerNotificationProvider(base,config)).toEqual({outcome:"indeterminate",code:"OUTCOME_UNKNOWN"});
});
it("network exceptions never expose provider tokens or contacts", async () => {
 mocks.fetch.mockRejectedValue(new Error("private-provider-token and recipient"));
 expect(await sendLearnerNotificationProvider(base,config)).toEqual({outcome:"indeterminate",code:"OUTCOME_UNKNOWN"});
});
it.each(["invalid JSON",JSON.stringify({sid:"invalid"}),"x".repeat(8193)])("invalid or oversized provider body is indeterminate", async body => {
 mocks.fetch.mockResolvedValue(new Response(body,{status:201}));
 expect(await sendLearnerNotificationProvider(base,config)).toEqual({outcome:"indeterminate",code:"OUTCOME_UNKNOWN"});
});
it.each(["https://127.0.0.1/private","https://fcm.googleapis.com.attacker.example/push","https://user:password@fcm.googleapis.com/push","https://fcm.googleapis.com:444/push"])("push subscription refuses unsafe target %s", async endpoint => {
 expect(LearnerPushDestination.safeParse({...subscription,endpoint}).success).toBe(false);
 expect(await sendLearnerNotificationProvider({...base,channel:"push",destination:{...subscription,endpoint}},config)).toEqual({outcome:"not_delivered",code:"INVALID_DESTINATION"});expect(mocks.push).not.toHaveBeenCalled();
});
it("uses per-request VAPID settings without global credential mutation", async () => {
 mocks.push.mockResolvedValue({statusCode:201});
 expect(await sendLearnerNotificationProvider({...base,channel:"push",destination:subscription},config)).toEqual({outcome:"sent",providerReceipt:"push_http_201"});
 expect(mocks.push.mock.calls[0]![2]).toMatchObject({vapidDetails:config.push,timeout:10000,TTL:300,contentEncoding:"aes128gcm"});
});
it("email keeps existing idempotent sender and sanitizes its failures", async () => {
 const input={...base,channel:"email" as const,destination:{email:"synthetic@invalid.example"}};
 mocks.email.mockResolvedValue({id:"synthetic-email-receipt"});expect((await sendLearnerNotificationProvider(input,config)).outcome).toBe("sent");
 expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({idempotencyKey:base.idempotencyKey,to:"synthetic@invalid.example"}));
 mocks.email.mockRejectedValue(new TransactionalEmailError("network"));expect((await sendLearnerNotificationProvider(input,config)).outcome).toBe("indeterminate");
});
it("invalid origin or caller destination never contacts a provider", async () => {
 expect((await sendLearnerNotificationProvider({...base,appOrigin:"http://127.0.0.1/"},config)).code).toBe("CONFIGURATION");
 expect((await sendLearnerNotificationProvider({...base,destination:{phone:"+886900000001",url:"https://foreign.example"}},config)).code).toBe("INVALID_DESTINATION");
 expect(mocks.fetch).not.toHaveBeenCalled();
});

it("keeps valid base64 WhatsApp receipts while dropping arbitrary response fields", async () => {
 mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ messages:[{id:"wamid.synthetic+/=="}],recipient:"private-provider-data" }),{status:200}));
 expect(await sendLearnerNotificationProvider({...base,channel:"whatsapp"},config)).toEqual({outcome:"sent",providerReceipt:"wamid.synthetic+/=="});
});
