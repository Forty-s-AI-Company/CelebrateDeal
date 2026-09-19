/**
 * Deterministic AI funnel assistant.
 *
 * The production adapter can replace the heuristic implementation later, but
 * this module deliberately has no network or secret dependency. That keeps
 * previews and local tests useful when an AI provider is unavailable.
 */

const MAX_INPUT_LENGTH = 500;

function clean(value: string, fallback: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return (normalized || fallback).slice(0, MAX_INPUT_LENGTH);
}

function sentence(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith("。") || trimmed.endsWith("！") || trimmed.endsWith("？")
    ? trimmed
    : `${trimmed}。`;
}

export type FunnelSalesCopyInput = {
  topic: string;
  painPoints: string[];
  targetAudience: string;
};

export type FunnelSalesCopy = {
  heroHeadline: string;
  painPoints: string[];
  valuePropositions: string[];
  faqs: Array<{ question: string; answer: string }>;
};

export type DirectorTimelineInput = {
  durationMinutes: number;
  topic?: string;
};

export type DirectorTimelineNode = {
  minute: number;
  endMinute: number;
  type: "warmup" | "teaching" | "assistant_chat" | "poll" | "offer" | "q_and_a" | "close";
  title: string;
  action: string;
};

export type DirectorTimelineScript = {
  durationMinutes: number;
  nodes: DirectorTimelineNode[];
};

export type LeadClosingInsightsInput = {
  watchedSeconds: number;
  bookingAnswers: string[] | Record<string, string>;
};

export type LeadClosingInsights = {
  suggestions: [string, string, string];
};

/** Generate a safe, deterministic one-page sales copy draft. */
export function generateFunnelSalesCopy(input: FunnelSalesCopyInput): FunnelSalesCopy {
  const topic = clean(input.topic, "你的專業主題");
  const audience = clean(input.targetAudience, "正在尋找可落地解法的學員");
  const painPoints = (input.painPoints ?? [])
    .map((pain) => clean(pain, "目前遇到的成長瓶頸"))
    .filter(Boolean)
    .slice(0, 5);
  const normalizedPainPoints = painPoints.length > 0 ? painPoints : ["有方向卻缺少可執行的步驟"];

  return {
    heroHeadline: `${audience}，用一套清楚方法把「${topic}」變成看得見的成果`,
    painPoints: normalizedPainPoints.map(sentence),
    valuePropositions: [
      `拆解 ${topic} 的關鍵框架，從概念直接走到下一步行動。`,
      `提供可複製的流程與範例，降低 ${audience} 自己摸索的時間成本。`,
      "用直播互動與實作檢核，讓每次學習都能累積成可衡量的進展。",
    ],
    faqs: [
      { question: "這場內容適合誰？", answer: `適合${audience}，尤其是已經嘗試過但想要更穩定成果的人。` },
      { question: "需要先具備相關經驗嗎？", answer: "不需要；會從共同基礎開始，並提供可依自身情境調整的步驟。" },
      { question: "參加後可以帶走什麼？", answer: `你會帶走一份 ${topic} 行動框架，以及能立即套用的練習與檢核清單。` },
    ],
  };
}

function boundedDuration(durationMinutes: number): number {
  if (!Number.isFinite(durationMinutes)) return 60;
  return Math.min(480, Math.max(15, Math.round(durationMinutes)));
}

/** Build interaction beats at stable percentages of the requested duration. */
export function generateDirectorTimelineScript(input: DirectorTimelineInput): DirectorTimelineScript {
  const durationMinutes = boundedDuration(input.durationMinutes);
  const topic = clean(input.topic ?? "今天的主題", "今天的主題");
  const points = [0, 0.08, 0.25, 0.5, 0.7, 0.84, 0.94]
    .map((ratio) => Math.min(durationMinutes - 1, Math.max(0, Math.round(durationMinutes * ratio))));
  const unique = points.filter((minute, index) => index === 0 || minute > points[index - 1]!);
  const labels: Array<[DirectorTimelineNode["type"], string, string]> = [
    ["warmup", "破冰與期待管理", "助教留言歡迎觀眾，請大家用一個關鍵字回覆目前最想解決的問題。"],
    ["teaching", "核心框架", `講解「${topic}」的第一個關鍵框架，穿插一個可立即完成的小練習。`],
    ["assistant_chat", "助教互動", "助教整理聊天室高頻問題並點名回應，讓沉默觀眾也有參與入口。"],
    ["poll", "快速投票", "發起單題投票，依結果切換案例或補充最需要的解釋。"],
    ["teaching", "案例與證據", "展示前後對照案例，說明方法如何落地以及常見誤區。"],
    ["offer", "限時行動邀請", "空投促銷券或專屬加碼，清楚說明適用對象、截止時間與下一步。"],
    ["close", "問答與收尾", "回答最後問題，再次複述行動連結與截止提醒，邀請觀眾現在完成下一步。"],
  ];
  const nodes = unique.map((minute, index) => {
    const [type, title, action] = labels[Math.min(index, labels.length - 1)]!;
    const next = unique[index + 1] ?? durationMinutes;
    return { minute, endMinute: Math.max(minute + 1, next), type, title, action };
  });
  return { durationMinutes, nodes };
}

/** Produce three respectful, consultative opening lines from engagement data. */
export function generateLeadClosingInsights(input: LeadClosingInsightsInput): LeadClosingInsights {
  const watchedSeconds = Number.isFinite(input.watchedSeconds) ? Math.max(0, Math.round(input.watchedSeconds)) : 0;
  const answers = Array.isArray(input.bookingAnswers)
    ? input.bookingAnswers
    : Object.values(input.bookingAnswers ?? {});
  const context = clean(answers.find(Boolean) ?? "目前的目標", "目前的目標");
  const depth = watchedSeconds >= 900 ? "你已經花時間看完重點" : watchedSeconds >= 180 ? "你剛剛看了幾個重要段落" : "我知道你可能還在快速了解方向";
  return {
    suggestions: [
      `${depth}，想先聽聽你目前最希望改善的「${context}」是什麼？`,
      "如果這件事能在接下來 30 天有一個可衡量的進展，你會把哪個結果視為最值得？",
      "我可以先依你的情況一起看適不適合，不急著做決定；你現在最大的顧慮會是時間、方法，還是投入成本？",
    ],
  };
}

// Friendly aliases for callers that prefer the shorter capability names.
export const createFunnelSalesCopy = generateFunnelSalesCopy;
export const createDirectorTimelineScript = generateDirectorTimelineScript;
export const createLeadClosingInsights = generateLeadClosingInsights;
