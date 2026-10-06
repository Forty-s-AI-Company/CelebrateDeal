import { afterEach,beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({origin:vi.fn(),configuration:vi.fn()}));
vi.mock("./app-url",()=>({getCanonicalAppUrl:mocks.origin}));
vi.mock("./learner-notification-job",()=>({readLearnerNotificationProviderConfiguration:mocks.configuration}));
import { getLearnerNotificationCapabilities } from "./learner-notification-capabilities";
const env:NodeJS.ProcessEnv={NODE_ENV:"test",LEARNER_NOTIFICATIONS_EXECUTOR_ENABLED:"true",LEARNER_NOTIFICATIONS_JOB_VENDOR_IDS:"vendor-1"};
beforeEach(()=>{vi.clearAllMocks();mocks.origin.mockReturnValue("https://app.example.test");mocks.configuration.mockReturnValue({email:{enabled:true},sms:{authToken:"private-provider-credential"},push:{publicKey:"a".repeat(87),privateKey:"private-push-credential"}});});
afterEach(()=>vi.unstubAllEnvs());
it("returns only availability and the public VAPID key",()=>{expect(getLearnerNotificationCapabilities("vendor-1",env)).toEqual({availableChannels:["email","sms","push"],pushPublicKey:"a".repeat(87)});});
it.each(["","foreign","vendor-1,foreign/id",Array.from({length:26},(_,i)=>`vendor-${i}`).join(",")])("unapproved or invalid scope %s does not inspect providers",scope=>{expect(getLearnerNotificationCapabilities("vendor-1",{...env,LEARNER_NOTIFICATIONS_JOB_VENDOR_IDS:scope})).toEqual({availableChannels:[],pushPublicKey:null});expect(mocks.configuration).not.toHaveBeenCalled();});
it("disabled execution never exposes provider metadata",()=>{expect(getLearnerNotificationCapabilities("vendor-1",{...env,LEARNER_NOTIFICATIONS_EXECUTOR_ENABLED:"false"})).toEqual({availableChannels:[],pushPublicKey:null});expect(mocks.configuration).not.toHaveBeenCalled();});
it("unsafe/unavailable origin and invalid public push key fail closed",()=>{
 mocks.origin.mockReturnValue("http://127.0.0.1");expect(getLearnerNotificationCapabilities("vendor-1",env).availableChannels).toEqual([]);expect(mocks.configuration).not.toHaveBeenCalled();
 mocks.origin.mockImplementation(()=>{throw new Error("private-runtime");});expect(getLearnerNotificationCapabilities("vendor-1",env).availableChannels).toEqual([]);
 mocks.origin.mockReturnValue("https://app.example.test");mocks.configuration.mockReturnValue({push:{publicKey:"invalid",privateKey:"private"}});expect(getLearnerNotificationCapabilities("vendor-1",env)).toEqual({availableChannels:[],pushPublicKey:null});
});
