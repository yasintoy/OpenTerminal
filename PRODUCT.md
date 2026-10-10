# Product definition

## Platform and stack

OpenTerminal is a browser-based market terminal built with Next.js, React, TypeScript, Tailwind CSS, Zustand, TanStack Query, and lightweight-charts. The existing Express service supplies market data to the web application.

## Users

The decision-lab extension is for AI builders, commerce and fintech teams, and technically curious traders who want to understand what a decision model does without reading an API schema first.

## Purpose

Newsflash turns a familiar trading interface into an interactive model demonstration. A visitor and Commerce-1 receive the same bounded market event, each chooses UP, DOWN, or NO TRADE, and the next market window is revealed only after the visitor commits. The product must make speed, probabilities, bounded actions, and outcome scoring immediately legible.

## Core mechanism

Commerce-1 ranks supplied actions and returns a probability for each action. It does not write a trading thesis or execute an order. The application owns the account, position size, simulation rules, safety limits, and any eventual execution boundary.

## Context and constraints

- The original OpenTerminal remains the live-market context at `/`.
- The Newsflash experience lives at `/newsflash` and uses the same terminal design language.
- The first release is a paper-trading replay. It never moves money and is not investment advice.
- Captured or deterministic replay output must be labeled as replay output. Live model latency or inference cost must never be fabricated.
- Upstream market-data licenses and redistribution terms must be respected before a hosted live feed is enabled.
- The demo must still be understandable when the market API or model endpoint is unavailable.

## Brand commitments

- Preserve OpenTerminal's black, amber, red, green, compact monospace visual system.
- Present InferCrane and Commerce-1 as the model layer without obscuring the upstream OpenTerminal project.
- Prefer instrument-panel density and direct labels over marketing decoration.

## Evidence available today

- OpenTerminal provides the real terminal shell and live-market widgets.
- Commerce-1 weights, runtime, evaluations, and existing commerce demos are public in InferCrane-owned repositories and Hugging Face spaces.
- A production trading-specific evaluation and a hosted Commerce-1 inference endpoint are not yet connected to this fork.

## Design principles

1. Show the decision before explaining the architecture.
2. Never let a simulated result look like a live trade.
3. Keep the action space visible and bounded.
4. Reveal the model only after the human commits.
5. Make probability, latency, position size, and outcome independently inspectable.

## Accessibility and responsive behavior

All controls must be keyboard reachable, retain visible focus, and communicate state with text in addition to color. Desktop should resemble a professional terminal. Narrow screens should become a single readable column without horizontal scrolling.
