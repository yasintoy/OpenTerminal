import { NextRequest, NextResponse } from "next/server";

type Action = "UP" | "DOWN" | "NO TRADE";

type DecisionBody = {
  symbol?: unknown;
  headline?: unknown;
  context?: unknown;
  recentPrices?: unknown;
  fixture?: {
    action?: unknown;
    probabilities?: unknown;
    latencyMs?: unknown;
  };
};

const ACTIONS: Action[] = ["UP", "DOWN", "NO TRADE"];

function isAction(value: unknown): value is Action {
  return typeof value === "string" && ACTIONS.includes(value as Action);
}

function readProbabilities(value: unknown): Record<Action, number> | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const parsed = Object.fromEntries(
    ACTIONS.map((action) => [action, typeof candidate[action] === "number" ? candidate[action] : NaN]),
  ) as Record<Action, number>;
  const sum = ACTIONS.reduce((total, action) => total + parsed[action], 0);
  if (ACTIONS.some((action) => !Number.isFinite(parsed[action]) || parsed[action] < 0) || Math.abs(sum - 1) > 0.02) {
    return null;
  }
  return parsed;
}

function fixtureResponse(body: DecisionBody) {
  const action = isAction(body.fixture?.action) ? body.fixture.action : "NO TRADE";
  const probabilities = readProbabilities(body.fixture?.probabilities) ?? {
    UP: action === "UP" ? 0.7 : 0.15,
    DOWN: action === "DOWN" ? 0.7 : 0.15,
    "NO TRADE": action === "NO TRADE" ? 0.7 : 0.15,
  };
  const latencyMs = typeof body.fixture?.latencyMs === "number" ? body.fixture.latencyMs : 0;
  return NextResponse.json({ action, probabilities, latencyMs, source: "replay" });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as DecisionBody | null;
  if (!body || typeof body.symbol !== "string" || typeof body.headline !== "string" || !Array.isArray(body.recentPrices)) {
    return NextResponse.json({ error: "Invalid decision state." }, { status: 400 });
  }

  const endpoint = process.env.COMMERCE1_DECISIONS_URL?.trim();
  const apiKey = process.env.COMMERCE1_API_KEY?.trim();
  if (!endpoint || !apiKey) return fixtureResponse(body);

  const startedAt = performance.now();
  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Title": "InferCrane Newsflash",
      },
      body: JSON.stringify({
        model: process.env.COMMERCE1_MODEL?.trim() || "infercrane/commerce-1",
        state: {
          task: "Bounded paper-market event decision",
          symbol: body.symbol,
          headline: body.headline,
          context: typeof body.context === "string" ? body.context : "",
          recent_prices: body.recentPrices,
          horizon_minutes: 30,
          position_size_usd: 1000,
          constraints: ["paper simulation", "no order execution", "choose exactly one supplied action"],
        },
        questions: {
          market_action: {
            type: "choice",
            instructions:
              "Choose the single best bounded paper-market action from the supplied event and visible pre-event prices. Do not invent another action.",
            criteria: {
              UP: "Take a paper long position when upward direction is the strongest choice.",
              DOWN: "Take a paper short position when downward direction is the strongest choice.",
              "NO TRADE": "Stay flat when evidence is conflicting, weak, or too uncertain.",
            },
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });

    if (!upstream.ok) throw new Error(`Decision endpoint returned ${upstream.status}.`);
    const payload = (await upstream.json()) as {
      answers?: { market_action?: { choice?: unknown; probabilities?: unknown } };
    };
    const answer = payload.answers?.market_action;
    const action = answer?.choice;
    const probabilities = readProbabilities(answer?.probabilities);
    if (!isAction(action) || !probabilities) throw new Error("Decision endpoint returned an invalid choice answer.");

    return NextResponse.json({
      action,
      probabilities,
      latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
      source: "live",
    });
  } catch (error) {
    const fallback = fixtureResponse(body);
    fallback.headers.set("X-Newsflash-Fallback", error instanceof Error ? error.message : "Decision request failed.");
    return fallback;
  }
}
