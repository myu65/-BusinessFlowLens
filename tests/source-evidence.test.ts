import test from "node:test";
import assert from "node:assert/strict";
import { sourceEvidence } from "../lib/source-evidence";

test("an abbreviated literal quote expands within one sentence without losing the original spacing or Unicode", () => {
  const source = "調達可能と回答されたら 生産計画の担当が製造指図案を確認して確定します。";
  assert.equal(sourceEvidence(source, "「調達可能と回答されたら…製造指図案を確認して確定」"), source.replace(/します。$/, ""));
  assert.equal(sourceEvidence(`${source}\n${source.replace("回答されたら ", "回答されたら、")}`, "調達可能と回答されたら…製造指図案を確認して確定"), source.replace(/します。$/, ""));
  assert.equal(sourceEvidence("ＡＢＣ の担当が 確認を済ませ、計画を確定する。", "ABCの担当...計画を確定する"), "ＡＢＣ の担当が 確認を済ませ、計画を確定する");
  assert.equal(sourceEvidence("Teamsで回答する。", "Teamsで回答する"), "Teamsで回答する");
});

test("ellipsis cannot bridge another sentence, an omitted condition or negation, reversed fragments or ambiguous claims", () => {
  for (const source of [
    "調達可能と回答されたら確認する。製造指図案を確認して確定する。",
    "調達可能と回答されたら確定しない。製造指図案を確認して確定する。",
    "調達可能と回答されたら、ただし課長が許可した場合のみ、製造指図案を確認して確定する。",
    "調達可能と回答されたら、確定しないように注意して製造指図案を確認して確定する。",
    "製造指図案を確認して確定した後、調達可能と回答されたら確認する。",
    "調達可能と回答されたら担当Aが製造指図案を確認して確定する。調達可能と回答されたら担当Bが製造指図案を確認して確定する。",
  ]) assert.equal(sourceEvidence(source, "調達可能と回答されたら…製造指図案を確認して確定"), null);
  assert.equal(sourceEvidence("担当が確認する。", "担…認"), null);
  assert.equal(sourceEvidence("製造指図案を確認する。", "製造指図案を確定する"), null);
});
