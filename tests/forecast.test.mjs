import test from "node:test";
import assert from "node:assert/strict";
import { FORECAST_MIN_COMPARABLE, deriveForecast, parseForecastAnswer } from "../lib/forecast.ts";

function item(title, plays, outlier) {
  return { title, creator: "@ada", caption: `Caption ${title}`, plays, outlier };
}

const evidence = [
  item("Der Teardown, den alle speichern", 48_000, 6.1),
  item("Drei Fehler im Prompt", 12_000, 2.4),
  item("Nie wieder leere Captions", 31_000, 4.0),
  item("Die besten Tools 2026", 9_500, 2.1),
];

const answer = {
  comparable: ["Der Teardown, den alle speichern", "Nie wieder leere Captions", "Drei Fehler im Prompt"],
  risk: "Der Hook verspricht mehr, als das Reel zeigt.",
  tension: "Warum speichern alle einen Teardown, den keiner nachbaut?",
};

test("the range spans the plays of the comparable reels, nothing else", () => {
  const forecast = deriveForecast(answer, evidence);
  assert.deepEqual(forecast.range, { low: 12_000, high: 48_000 });
  assert.equal(forecast.comparable, 3);
  assert.equal(forecast.risk, answer.risk);
  assert.equal(forecast.tension, answer.tension);
});

test("potential follows the median outlier of the comparable reels", () => {
  assert.equal(deriveForecast(answer, evidence).potential, "medium");
  const high = deriveForecast({ ...answer, comparable: [evidence[0].title, evidence[2].title] }, [
    evidence[0],
    { ...evidence[2], outlier: 5.5 },
  ]);
  assert.equal(high.potential, "high");
  const low = deriveForecast({ ...answer, comparable: [evidence[1].title, evidence[3].title] }, evidence);
  assert.equal(low.potential, "low");
});

test("a title the packet does not carry is not a comparable reel", () => {
  const forecast = deriveForecast(
    { ...answer, comparable: ["Erfundenes Reel", "der teardown, den alle speichern ", "Nie wieder leere Captions"] },
    evidence,
  );
  assert.equal(forecast.comparable, 2);
  assert.deepEqual(forecast.range, { low: 31_000, high: 48_000 });
});

test("a title cited twice counts once", () => {
  const forecast = deriveForecast({ ...answer, comparable: [evidence[0].title, evidence[0].title] }, evidence);
  assert.equal(forecast.comparable, 1);
});

test("without a comparable base there is no range and no potential, only risk and tension", () => {
  assert.ok(FORECAST_MIN_COMPARABLE >= 2);
  for (const comparable of [[], ["Erfundenes Reel"], [evidence[0].title]]) {
    const forecast = deriveForecast({ ...answer, comparable }, evidence);
    assert.equal(forecast.range, null);
    assert.equal(forecast.potential, null);
    assert.equal(forecast.risk, answer.risk);
    assert.equal(forecast.tension, answer.tension);
  }
});

test("a forecast needs risk and tension", () => {
  assert.throws(() => deriveForecast({ ...answer, risk: "  " }, evidence), /risk/);
  assert.throws(() => deriveForecast({ ...answer, tension: "" }, evidence), /tension/);
});

test("risk and tension are bounded to one line", () => {
  const forecast = deriveForecast({ ...answer, risk: "r \n\n ".repeat(400), tension: "t".repeat(900) }, evidence);
  assert.ok(forecast.risk.length <= 400);
  assert.ok(!forecast.risk.includes("\n"));
  assert.ok(forecast.tension.length <= 400);
});

test("an answer without a forecast field yields none, the storyboard is untouched", () => {
  assert.equal(parseForecastAnswer({ hook: "x" }, evidence), null);
  assert.equal(parseForecastAnswer({ forecast: null }, evidence), null);
  assert.equal(parseForecastAnswer({ forecast: "nope" }, evidence), null);
  assert.equal(parseForecastAnswer({ forecast: { comparable: [] } }, evidence), null);
});

test("a present forecast field is derived like any other", () => {
  const forecast = parseForecastAnswer({ forecast: answer }, evidence);
  assert.deepEqual(forecast.range, { low: 12_000, high: 48_000 });
});
