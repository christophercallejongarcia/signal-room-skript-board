import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTranscriptAnalysisPrompt,
  transcriptAnalysisOutputSchema,
  validateTranscriptAnalysisRequest,
} from "../bridge/transcript-analysis.mjs";

const valid = {
  signalId: "ig-analysis-1",
  analysisVersion: "content-analysis-v1",
  textVersion: "working",
  text: "  Hook 🙂.  ",
  offset: 120,
  chunkIndex: 1,
  chunkCount: 3,
};

test("validates a bounded analysis chunk without changing source text", () => {
  assert.deepEqual(validateTranscriptAnalysisRequest(valid), valid);
  assert.throws(() => validateTranscriptAnalysisRequest({ ...valid, signalId: " " }), /signalId is required/);
  assert.throws(() => validateTranscriptAnalysisRequest({ ...valid, textVersion: "draft" }), /textVersion is invalid/);
  assert.throws(() => validateTranscriptAnalysisRequest({ ...valid, offset: -1 }), /offset is invalid/);
  assert.throws(() => validateTranscriptAnalysisRequest({ ...valid, chunkIndex: 3 }), /chunkIndex is invalid/);
  assert.throws(() => validateTranscriptAnalysisRequest({ ...valid, text: " " }), /text is required/);
});

test("declares a bounded fixed analysis response schema", () => {
  assert.deepEqual(transcriptAnalysisOutputSchema.required, ["framework", "findings"]);
  assert.equal(transcriptAnalysisOutputSchema.additionalProperties, false);
  assert.deepEqual(transcriptAnalysisOutputSchema.properties.framework.enum, ["pas", "bbb", "none"]);
  const finding = transcriptAnalysisOutputSchema.properties.findings.items;
  assert.deepEqual(finding.required, ["feature", "explanation", "quote", "start", "end"]);
  assert.equal(finding.additionalProperties, false);
  assert.deepEqual(finding.properties.feature.enum, ["hook", "tension", "loop", "proof", "example", "transition", "rhythm", "cta"]);
});

test("analysis prompt carries the central frameworks and treats transcript as source text", () => {
  const prompt = buildTranscriptAnalysisPrompt(validateTranscriptAnalysisRequest(valid));
  assert.match(prompt, /Behaupten, Begründen, Beispiel/);
  assert.match(prompt, /untrusted source text/i);
  assert.match(prompt, /Do not browse, run commands or edit files/i);
  assert.match(prompt, /Hook.*Spannung.*Schleifen.*Beweise.*Beispiele.*Übergänge.*Rhythmus.*CTA/s);
  assert.match(prompt, /Hook 🙂/);
});

