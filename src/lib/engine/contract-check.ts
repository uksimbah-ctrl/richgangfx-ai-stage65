import { digitChoices } from "./math.ts";

/** Digit contracts Deriv prices once. The proposal schema does not stream them. */
const DIGIT_TYPES = new Set(["DIGITEVEN", "DIGITODD", "DIGITOVER", "DIGITUNDER", "DIGITMATCH", "DIGITDIFF"]);

const DURATION_UNITS = new Set(["t", "s", "m", "h", "d"]);

export function isDigitContract(type: string | null | undefined): boolean {
  return Boolean(type && DIGIT_TYPES.has(type));
}

export function streamsProposal(type: string | null | undefined): boolean {
  return !isDigitContract(type);
}

export type ProposalCheck =
  | { ok: true; barrier?: string; duration: number; durationUnit: "t" | "s" | "m" | "h" | "d" }
  | { ok: false; reason: string };

/**
 * Reject a digit proposal before it is sent.
 * Non-digit contracts are left to their own request builder.
 */
export function checkDigitProposal(input: {
  contractType: string | null | undefined;
  symbol: string;
  barrier?: string | null;
  duration?: number | null;
  durationUnit?: string | null;
  stake?: number | null;
  currency?: string | null;
}): ProposalCheck {
  if (!isDigitContract(input.contractType)) {
    return { ok: true, duration: input.duration ?? 1, durationUnit: unitOf(input.durationUnit) };
  }
  const type = input.contractType as string;
  if (!/^\w{2,30}$/.test(input.symbol)) {
    return { ok: false, reason: `${label(type)} needs a Deriv symbol. "${input.symbol || "blank"}" is not one.` };
  }
  if (input.currency != null && !input.currency.trim()) {
    return { ok: false, reason: `${label(type)} has no account currency, so the proposal was not sent.` };
  }
  if (input.stake != null && !(input.stake > 0)) {
    return { ok: false, reason: `${label(type)} stake must be above zero. The proposal was not sent.` };
  }
  const duration = input.duration;
  if (duration == null || !Number.isInteger(duration) || duration < 1) {
    return { ok: false, reason: `${label(type)} needs a duration of at least 1. The proposal was not sent.` };
  }
  if (!DURATION_UNITS.has(input.durationUnit ?? "")) {
    return { ok: false, reason: `${label(type)} duration unit must be ticks, seconds, minutes, hours, or days. The proposal was not sent.` };
  }
  const choices = digitChoices(type);
  if (choices == null) {
    if (input.barrier != null && input.barrier !== "") {
      return { ok: false, reason: `${label(type)} does not take a prediction digit. Remove it before sending the proposal.` };
    }
    return { ok: true, duration, durationUnit: unitOf(input.durationUnit) };
  }
  const raw = input.barrier?.trim() ?? "";
  if (!/^\d$/.test(raw)) {
    const span = choices.length ? `${choices[0]}–${choices[choices.length - 1]}` : "none";
    return {
      ok: false,
      reason: `${label(type)} needs a prediction digit (${span}). Nothing was sent to Deriv.`,
    };
  }
  const barrier = Number(raw);
  if (!choices.includes(barrier)) {
    const span = choices.length ? `${choices[0]}–${choices[choices.length - 1]}` : "none";
    return {
      ok: false,
      reason: `${label(type)} needs a prediction digit (${span}). Nothing was sent to Deriv.`,
    };
  }
  return { ok: true, barrier: String(barrier), duration, durationUnit: unitOf(input.durationUnit) };
}

export function restoreDigitPick(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 9 ? value : null;
}

function unitOf(unit: string | null | undefined): "t" | "s" | "m" | "h" | "d" {
  return unit === "s" || unit === "m" || unit === "h" || unit === "d" || unit === "t" ? unit : "t";
}

function label(type: string): string {
  if (type === "DIGITMATCH") return "Matches";
  if (type === "DIGITDIFF") return "Differs";
  if (type === "DIGITOVER") return "Over";
  if (type === "DIGITUNDER") return "Under";
  if (type === "DIGITEVEN") return "Even";
  if (type === "DIGITODD") return "Odd";
  return type;
}
