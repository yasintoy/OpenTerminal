"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import TopBar from "./TopBar";

type Action = "UP" | "DOWN" | "NO TRADE";
type Phase = "choose" | "revealed";

type Scenario = {
  symbol: string;
  company: string;
  clock: string;
  headline: string;
  context: string;
  tags: string[];
  before: number[];
  after: number[];
  modelAction: Action;
  probabilities: Record<Action, number>;
  latencyMs: number;
};

type Result = {
  round: number;
  modelAction: Action;
  humanAction: Action | null;
  outcome: Action;
  movePct: number;
  modelPnl: number;
  humanPnl: number;
  latencyMs: number;
  source: "live" | "replay";
};

type ModelDecision = {
  action: Action;
  probabilities: Record<Action, number>;
  latencyMs: number;
  source: "live" | "replay";
};

const STARTING_BALANCE = 10_000;
const POSITION_SIZE = 1_000;

const SCENARIOS: Scenario[] = [
  {
    symbol: "NVDA",
    company: "NVIDIA",
    clock: "09:31 ET",
    headline: "Chipmaker raises its quarterly revenue outlook after data-center demand accelerates",
    context: "Guidance moved above the visible analyst range. The replay withholds the next 30 minutes of price action.",
    tags: ["EARNINGS", "GUIDANCE", "SEMIS"],
    before: [118.1, 118.4, 118.2, 118.8, 119.1, 118.9, 119.4, 119.2, 119.7, 119.5, 119.9, 120.2, 120.0, 120.4, 120.3, 120.7, 120.5, 120.8],
    after: [121.2, 121.8, 122.4, 122.1, 123.0, 123.6, 123.4, 124.1, 124.6],
    modelAction: "UP",
    probabilities: { UP: 0.74, DOWN: 0.11, "NO TRADE": 0.15 },
    latencyMs: 86,
  },
  {
    symbol: "TSLA",
    company: "TESLA",
    clock: "10:04 ET",
    headline: "Quarterly vehicle deliveries miss the lowest published estimate",
    context: "The event arrives during regular trading. No position is carried in from the prior round.",
    tags: ["DELIVERIES", "AUTO", "MISS"],
    before: [251.0, 251.8, 252.2, 251.6, 252.7, 253.1, 252.6, 253.4, 253.2, 252.9, 253.5, 253.0, 252.8, 253.1, 252.7, 252.5, 252.9, 252.4],
    after: [250.8, 249.9, 248.7, 247.8, 246.6, 247.1, 245.9, 244.8, 244.2],
    modelAction: "DOWN",
    probabilities: { UP: 0.09, DOWN: 0.81, "NO TRADE": 0.1 },
    latencyMs: 79,
  },
  {
    symbol: "AAPL",
    company: "APPLE",
    clock: "13:12 ET",
    headline: "Regulator opens a review; the filing contains no proposed remedy or timetable",
    context: "The headline is negative but incomplete. The model may choose not to take market direction.",
    tags: ["REGULATION", "FILING", "UNCERTAIN"],
    before: [229.4, 229.1, 229.6, 229.3, 229.8, 230.0, 229.7, 229.9, 229.6, 229.8, 229.5, 229.7, 229.4, 229.6, 229.5, 229.8, 229.7, 229.6],
    after: [229.4, 229.8, 229.5, 229.7, 229.3, 229.6, 229.8, 229.5, 229.7],
    modelAction: "NO TRADE",
    probabilities: { UP: 0.22, DOWN: 0.27, "NO TRADE": 0.51 },
    latencyMs: 72,
  },
  {
    symbol: "AMZN",
    company: "AMAZON",
    clock: "14:08 ET",
    headline: "Cloud unit reports a reacceleration in growth and expands operating margin",
    context: "The event includes both a demand signal and a profitability signal. Horizon: 30 minutes.",
    tags: ["CLOUD", "MARGIN", "EARNINGS"],
    before: [185.2, 185.0, 185.4, 185.6, 185.3, 185.8, 186.0, 185.7, 186.1, 186.3, 186.0, 186.4, 186.2, 186.5, 186.3, 186.7, 186.4, 186.6],
    after: [187.0, 187.4, 187.9, 188.3, 188.1, 188.8, 189.0, 189.5, 189.8],
    modelAction: "UP",
    probabilities: { UP: 0.69, DOWN: 0.12, "NO TRADE": 0.19 },
    latencyMs: 83,
  },
  {
    symbol: "META",
    company: "META PLATFORMS",
    clock: "15:17 ET",
    headline: "Company announces a large capital-spending increase without changing near-term revenue guidance",
    context: "Competing signals make this the hardest replay in the set. The next window is still hidden.",
    tags: ["CAPEX", "GUIDANCE", "MIXED"],
    before: [566.1, 566.7, 566.3, 567.0, 567.4, 567.1, 567.8, 568.0, 567.6, 568.2, 568.4, 568.1, 567.9, 568.3, 568.0, 568.2, 567.8, 568.1],
    after: [567.4, 566.8, 566.1, 565.4, 565.9, 564.8, 564.2, 563.5, 563.1],
    modelAction: "DOWN",
    probabilities: { UP: 0.24, DOWN: 0.49, "NO TRADE": 0.27 },
    latencyMs: 91,
  },
];

function formatMoney(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function actionClass(action: Action) {
  if (action === "UP") return "up";
  if (action === "DOWN") return "down";
  return "amber";
}

function pnlFor(action: Action | null, movePct: number) {
  if (!action || action === "NO TRADE") return 0;
  const direction = action === "UP" ? 1 : -1;
  return POSITION_SIZE * (movePct / 100) * direction;
}

function outcomeFor(movePct: number): Action {
  if (Math.abs(movePct) < 0.35) return "NO TRADE";
  return movePct > 0 ? "UP" : "DOWN";
}

function MarketReplayChart({ scenario, revealed }: { scenario: Scenario; revealed: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: "#0a0a0a" },
        textColor: "#808080",
        fontFamily: '"SF Mono", "Menlo", "Consolas", monospace',
        fontSize: 10,
        attributionLogo: false,
      },
      grid: { vertLines: { color: "#171717" }, horzLines: { color: "#171717" } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "#262626" },
      timeScale: { borderColor: "#262626", timeVisible: true, secondsVisible: false },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });
    chartRef.current = chart;

    const closes = revealed ? [...scenario.before, ...scenario.after] : scenario.before;
    const baseTime = 1_728_000_000;
    const bars = closes.map((close, index) => {
      const open = index === 0 ? close - 0.12 : closes[index - 1];
      const spread = Math.max(close * 0.0014, 0.14);
      return {
        time: (baseTime + index * 60) as UTCTimestamp,
        open,
        high: Math.max(open, close) + spread,
        low: Math.min(open, close) - spread,
        close,
      };
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#00c853",
      downColor: "#ff3d3d",
      wickUpColor: "#00c853",
      wickDownColor: "#ff3d3d",
      borderUpColor: "#00c853",
      borderDownColor: "#ff3d3d",
      priceLineVisible: true,
      lastValueVisible: true,
    });
    candleSeries.setData(bars);

    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    volume.setData(
      bars.map((bar, index) => ({
        time: bar.time,
        value: 160_000 + ((index * 83_731) % 410_000),
        color: bar.close >= bar.open ? "rgba(0,200,83,0.35)" : "rgba(255,61,61,0.35)",
      })),
    );

    chart.timeScale().fitContent();
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [revealed, scenario]);

  return <div ref={containerRef} className="newsflash-chart" aria-label={`${scenario.symbol} paper market replay chart`} />;
}

function ProbabilityBar({ action, value }: { action: Action; value: number }) {
  return (
    <div className="probability-row">
      <span className={actionClass(action)}>{action}</span>
      <span className="probability-track" aria-hidden="true">
        <span className={`probability-fill probability-${action.toLowerCase().replace(" ", "-")}`} style={{ transform: `scaleX(${value})` }} />
      </span>
      <strong>{Math.round(value * 100)}%</strong>
    </div>
  );
}

export default function NewsflashTerminal() {
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<Phase>("choose");
  const [selected, setSelected] = useState<Action | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [modelDecision, setModelDecision] = useState<ModelDecision | null>(null);
  const [decisionError, setDecisionError] = useState(false);
  const scenario = SCENARIOS[round];

  useEffect(() => {
    const controller = new AbortController();
    setModelDecision(null);
    setDecisionError(false);
    fetch("/api/newsflash/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: scenario.symbol,
        headline: scenario.headline,
        context: scenario.context,
        recentPrices: scenario.before,
        fixture: {
          action: scenario.modelAction,
          probabilities: scenario.probabilities,
          latencyMs: scenario.latencyMs,
        },
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as ModelDecision;
      })
      .then(setModelDecision)
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDecisionError(true);
      });
    return () => controller.abort();
  }, [scenario]);

  const modelBalance = useMemo(
    () => STARTING_BALANCE + results.reduce((sum, result) => sum + result.modelPnl, 0),
    [results],
  );
  const humanBalance = useMemo(
    () => STARTING_BALANCE + results.reduce((sum, result) => sum + result.humanPnl, 0),
    [results],
  );
  const modelWins = results.filter((result) => result.modelAction === result.outcome).length;
  const averageLatency = results.length
    ? Math.round(results.reduce((sum, result) => sum + result.latencyMs, 0) / results.length)
    : 0;

  const reveal = useCallback(
    (humanAction: Action | null) => {
      if (phase === "revealed" || !modelDecision) return;
      const entry = scenario.before[scenario.before.length - 1];
      const exit = scenario.after[scenario.after.length - 1];
      const movePct = ((exit - entry) / entry) * 100;
      const outcome = outcomeFor(movePct);
      const result: Result = {
        round,
        modelAction: modelDecision.action,
        humanAction,
        outcome,
        movePct,
        modelPnl: pnlFor(modelDecision.action, movePct),
        humanPnl: pnlFor(humanAction, movePct),
        latencyMs: modelDecision.latencyMs,
        source: modelDecision.source,
      };
      setResults((current) => [...current.filter((item) => item.round !== round), result]);
      setPhase("revealed");
    },
    [modelDecision, phase, round, scenario],
  );

  const nextRound = useCallback(() => {
    if (round >= SCENARIOS.length - 1) {
      setAutoPlaying(false);
      return;
    }
    setRound((current) => current + 1);
    setSelected(null);
    setPhase("choose");
  }, [round]);

  useEffect(() => {
    if (!autoPlaying || !modelDecision) return;
    const timer = window.setTimeout(() => {
      if (phase === "choose") reveal(null);
      else nextRound();
    }, phase === "choose" ? 800 : 1700);
    return () => window.clearTimeout(timer);
  }, [autoPlaying, modelDecision, nextRound, phase, reveal]);

  const reset = (autoplay = false) => {
    setRound(0);
    setPhase("choose");
    setSelected(null);
    setResults([]);
    setAutoPlaying(autoplay);
  };

  const entry = scenario.before[scenario.before.length - 1];
  const exit = scenario.after[scenario.after.length - 1];
  const currentMove = ((exit - entry) / entry) * 100;
  const currentOutcome = outcomeFor(currentMove);
  const isFinished = phase === "revealed" && round === SCENARIOS.length - 1;
  const displayedDecision = modelDecision ?? {
    action: scenario.modelAction,
    probabilities: scenario.probabilities,
    latencyMs: scenario.latencyMs,
    source: "replay" as const,
  };

  return (
    // Direction contract: retain OpenTerminal's dense black/amber market shell; add one bounded, game-like decision loop with explicit replay provenance.
    <div className="newsflash-root">
      <TopBar replayMode />
      <div className="newsflash-subbar">
        <div className="newsflash-brand">
          <span className="amber font-bold">INFERCRANE</span>
          <span className="dim">/</span>
          <strong>NEWSFLASH</strong>
        </div>
        <nav aria-label="Terminal modes">
          <Link href="/" className="term-btn-link">LIVE TERMINAL</Link>
          <span className="term-btn-link active" aria-current="page">MODEL REPLAY</span>
        </nav>
        <div className="newsflash-mode">
          <span className="down">● SIMULATION</span>
          <span className="dim">NO ORDERS PLACED</span>
          <span className={modelDecision?.source === "live" ? "up" : "amber"}>
            {modelDecision?.source === "live" ? "LIVE MODEL" : "REPLAY OUTPUT"}
          </span>
        </div>
      </div>

      <main className="newsflash-main">
        <section className="newsflash-stats" aria-label="Simulation status">
          <div><span>ROUND</span><strong>{String(round + 1).padStart(2, "0")} / {String(SCENARIOS.length).padStart(2, "0")}</strong></div>
          <div><span>COMMERCE-1 PAPER</span><strong className={modelBalance >= STARTING_BALANCE ? "up" : "down"}>{formatMoney(modelBalance)}</strong></div>
          <div><span>YOUR PAPER</span><strong className={humanBalance >= STARTING_BALANCE ? "up" : "down"}>{formatMoney(humanBalance)}</strong></div>
          <div><span>MODEL HIT RATE</span><strong>{results.length ? `${modelWins}/${results.length}` : "—"}</strong></div>
          <div><span>AVG MODEL TIME</span><strong>{averageLatency ? `${averageLatency} ms` : "—"}</strong></div>
        </section>

        <div className="newsflash-workspace">
          <section className="terminal-panel newsflash-market-panel">
            <div className="panel-title">
              <span>Market replay <span className="text-[var(--text)] ml-2">{scenario.symbol}</span></span>
              <span className="dim">30 MIN HORIZON · $1,000 PAPER POSITION</span>
            </div>
            <div className="newsflash-tape">
              <div>
                <span className="newsflash-symbol">{scenario.symbol}</span>
                <span className="dim">{scenario.company}</span>
              </div>
              <div className="newsflash-price">
                <strong>{(phase === "revealed" ? exit : entry).toFixed(2)}</strong>
                <span className={phase === "revealed" ? actionClass(currentOutcome) : "dim"}>
                  {phase === "revealed" ? `${currentMove >= 0 ? "+" : ""}${currentMove.toFixed(2)}%` : "OUTCOME HIDDEN"}
                </span>
              </div>
            </div>
            <article className="newsflash-headline">
              <div className="newsflash-kicker">
                <span className="down">BREAKING</span>
                <span>{scenario.clock}</span>
                <span>REPLAY EVENT {round + 1}</span>
              </div>
              <h1>{scenario.headline}</h1>
              <p>{scenario.context}</p>
              <div className="newsflash-tags">
                {scenario.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
            </article>
            <MarketReplayChart scenario={scenario} revealed={phase === "revealed"} />
            <div className="newsflash-chart-footer">
              <span className="amber">▲ EVENT</span>
              <span className="dim">Price window after the event stays hidden until the decision is locked.</span>
              <span>{phase === "revealed" ? "WINDOW REVEALED" : "AWAITING DECISION"}</span>
            </div>
          </section>

          <aside className="terminal-panel newsflash-decision-panel">
            <div className="panel-title">
              <span>Decision console</span>
              <span>{autoPlaying ? "AUTOPILOT" : "HUMAN VS MODEL"}</span>
            </div>

            <div className="newsflash-order">
              <span className="dim">STANDING ORDER</span>
              <p>Given the headline and visible market state, choose the next 30-minute action.</p>
              <div className="newsflash-contract">
                <span>OPTIONS</span><strong>3</strong>
                <span>OUTPUT</span><strong>CHOICE + PROBABILITIES</strong>
                <span>GENERATED TOKENS</span><strong>0</strong>
              </div>
            </div>

            {phase === "choose" ? (
              <div className="newsflash-human-turn">
                <span className="dim">YOUR CALL</span>
                <h2>{autoPlaying ? "Commerce-1 is reading the event…" : "What happens next?"}</h2>
                {!autoPlaying && (
                  <>
                    <div className="newsflash-actions" role="group" aria-label="Choose a market direction">
                      {(["UP", "DOWN", "NO TRADE"] as Action[]).map((action) => (
                        <button
                          key={action}
                          type="button"
                          className={selected === action ? "selected" : ""}
                          onClick={() => setSelected(action)}
                          aria-pressed={selected === action}
                        >
                          <span className={actionClass(action)}>{action === "UP" ? "↑" : action === "DOWN" ? "↓" : "—"}</span>
                          <strong>{action}</strong>
                        </button>
                      ))}
                    </div>
                    <button type="button" className="newsflash-primary" disabled={!selected || !modelDecision} onClick={() => reveal(selected)}>
                      {modelDecision ? "LOCK DECISION" : "MODEL READING…"}
                    </button>
                    <button type="button" className="newsflash-secondary" onClick={() => reset(true)}>
                      WATCH 5-EVENT AUTOPILOT
                    </button>
                  </>
                )}
                <div className="newsflash-sealed">
                  <span>COMMERCE-1</span>
                  <strong>{decisionError ? "CALL UNAVAILABLE" : modelDecision ? "CALL SEALED" : "READING EVENT"}</strong>
                  <p>{decisionError ? "The decision endpoint did not return a usable result." : "The model result is hidden until you commit."}</p>
                </div>
              </div>
            ) : (
              <div className="newsflash-reveal" aria-live="polite">
                <span className="dim">COMMERCE-1 CALLED</span>
                <div className={`newsflash-model-call ${actionClass(displayedDecision.action)}`}>
                  <strong>{displayedDecision.action}</strong>
                  <span>{displayedDecision.latencyMs} ms</span>
                </div>
                <div className="newsflash-probabilities">
                  {(["UP", "DOWN", "NO TRADE"] as Action[]).map((action) => (
                    <ProbabilityBar key={action} action={action} value={displayedDecision.probabilities[action]} />
                  ))}
                </div>
                <div className="newsflash-result-grid">
                  <div><span>MARKET</span><strong className={actionClass(currentOutcome)}>{currentOutcome}</strong></div>
                  <div><span>MODEL P&L</span><strong className={pnlFor(displayedDecision.action, currentMove) >= 0 ? "up" : "down"}>{formatMoney(pnlFor(displayedDecision.action, currentMove))}</strong></div>
                  <div><span>YOUR CALL</span><strong>{selected ?? (autoPlaying ? "WATCHING" : "—")}</strong></div>
                  <div><span>YOUR P&L</span><strong className={pnlFor(selected, currentMove) >= 0 ? "up" : "down"}>{formatMoney(pnlFor(selected, currentMove))}</strong></div>
                </div>
                {isFinished ? (
                  <button type="button" className="newsflash-primary" onClick={() => reset(false)}>PLAY AGAIN</button>
                ) : (
                  <button type="button" className="newsflash-primary" onClick={nextRound}>{autoPlaying ? "RUNNING…" : "NEXT EVENT"}</button>
                )}
              </div>
            )}

            <div className="newsflash-provenance">
              <strong>REPLAY PROVENANCE</strong>
              <p>{displayedDecision.source === "live" ? "Commerce-1 is connected for the model call; the market event and account remain a synthetic paper replay." : "Deterministic synthetic market events and replay outputs. Set the Commerce-1 server variables to replace these fixtures with live model calls."} This is not investment advice.</p>
            </div>
          </aside>

          <section className="terminal-panel newsflash-ledger-panel">
            <div className="panel-title">
              <span>Decision ledger</span>
              <span>{results.length} / {SCENARIOS.length} SETTLED</span>
            </div>
            {results.length === 0 ? (
              <div className="newsflash-empty">No settled events. Lock a decision to start the paper ledger.</div>
            ) : (
              <div className="newsflash-ledger-wrap">
                <table className="data-table newsflash-ledger">
                  <thead><tr><th>Event</th><th>Symbol</th><th>Model</th><th>You</th><th>Market</th><th>Move</th><th>Model P&amp;L</th><th>Time</th></tr></thead>
                  <tbody>
                    {[...results].reverse().map((result) => {
                      const item = SCENARIOS[result.round];
                      return (
                        <tr key={result.round}>
                          <td>#{String(result.round + 1).padStart(2, "0")}</td>
                          <td>{item.symbol}</td>
                          <td className={actionClass(result.modelAction)}>{result.modelAction}</td>
                          <td>{result.humanAction ?? "WATCH"}</td>
                          <td className={actionClass(result.outcome)}>{result.outcome}</td>
                          <td className={result.movePct >= 0 ? "up" : "down"}>{result.movePct >= 0 ? "+" : ""}{result.movePct.toFixed(2)}%</td>
                          <td className={result.modelPnl >= 0 ? "up" : "down"}>{formatMoney(result.modelPnl)}</td>
                          <td>{result.latencyMs} ms · {result.source === "live" ? "LIVE" : "REPLAY"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
