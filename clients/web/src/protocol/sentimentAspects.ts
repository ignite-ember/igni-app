/**
 * The aspects a ``user_sentiment`` push carries: for each question Laya
 * answered about the person's message, the label it chose and every
 * label's probability, so a listener can threshold them itself.
 */

import { WirePayload } from "./wirePayload";

/** One label of a question Laya answered, and its probability. */
export interface LabelProbability {
  label: string;
  probability: number;
}

/** The label Laya chose, and every label's probability in the question's order. */
export interface SentimentAspect {
  answer: string;
  probabilities: LabelProbability[];
}

/** Every question Laya answered about the message. */
export interface SentimentAspects {
  feeling: SentimentAspect;
  gesture: SentimentAspect;
  negativeReason: SentimentAspect;
  positiveReason: SentimentAspect;
  repeat: SentimentAspect;
  redoRequested: SentimentAspect;
  taskDone: SentimentAspect;
  intensity: SentimentAspect;
}

/** The wire name of each aspect, by its name here. */
const WIRE_NAMES: Record<keyof SentimentAspects, string> = {
  feeling: "feeling",
  gesture: "gesture",
  negativeReason: "negative_reason",
  positiveReason: "positive_reason",
  repeat: "repeat",
  redoRequested: "redo_requested",
  taskDone: "task_done",
  intensity: "intensity",
};

function parseAspect(raw: unknown): SentimentAspect | null {
  if (!WirePayload.isRecord(raw)) return null;
  const p = new WirePayload(raw);
  const answer = p.optionalString("answer");
  const entries = p.value("probabilities");
  if (answer === undefined || !Array.isArray(entries)) return null;
  const probabilities: LabelProbability[] = [];
  for (const entry of entries) {
    const e = new WirePayload(entry);
    const label = e.optionalString("label");
    const probability = e.optionalNumber("probability");
    if (label === undefined || probability === undefined) return null;
    probabilities.push({ label, probability });
  }
  return { answer, probabilities };
}

/** The aspects, or ``null`` when the push has none or any of them is malformed. */
export function parseSentimentAspects(raw: unknown): SentimentAspects | null {
  if (!WirePayload.isRecord(raw)) return null;
  const parsed: Partial<SentimentAspects> = {};
  for (const [name, wire] of Object.entries(WIRE_NAMES) as [keyof SentimentAspects, string][]) {
    const aspect = parseAspect(raw[wire]);
    if (!aspect) return null;
    parsed[name] = aspect;
  }
  return parsed as SentimentAspects;
}
