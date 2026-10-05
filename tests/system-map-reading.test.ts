import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createChemicalCompany } from "../lib/chemical-company";
import { knowledgeIndex } from "../lib/knowledge";
import { systemRelationships } from "../lib/relationship-overview";
import { SystemRelationshipMap } from "../components/SystemRelationshipMap";

test("system exploration restores the chosen tool, relationship layer and evidence; its detail action precedes the diagram", () => {
  const graph=createChemicalCompany(), before=JSON.stringify(graph), view=knowledgeIndex(graph,"current");
  const systems=graph.nodes.filter(n=>n.kind==="system"), tool=systems.find(n=>n.label==="Microsoft Teams")!;
  const category=graph.knowledge!.systems.find(s=>s.systemId===tool.id)!.categoryId;
  const relation=systemRelationships(graph,"current",view.rows.map(r=>r.workflow.id),systems.map(n=>n.id)).find(r=>r.kind==="dependency"&&(r.source===tool.id||r.target===tool.id))!;
  const html=renderToStaticMarkup(createElement(SystemRelationshipMap,{graph,scope:"current",systems,view,onSelect:()=>{},onActivity:()=>{},onWorkflow:()=>{},
    position:{categoryId:category,systemId:tool.id,page:0,relationPage:0,relationId:relation.id,relationKind:"dependency"}}));
  assert.match(html,/Microsoft Teamsと、直接つながる道具/);
  assert.match(html,/aria-pressed="true">稼働の依存/);
  assert.match(html,/関係の根拠/);
  assert.equal((html.match(/Microsoft Teamsの仕事・情報を開く/g)??[]).length,1);
  assert.ok(html.indexOf("Microsoft Teamsの仕事・情報を開く")<html.indexOf('aria-label="道具のまとまりと関係図"'));
  assert.equal(JSON.stringify(graph),before);
});

test("a tool outside the current filter does not restore an unrelated selection or a drill action",()=>{
  const graph=createChemicalCompany(), view=knowledgeIndex(graph,"current","該当しない仕事の名前");
  const systems=graph.nodes.filter(n=>n.kind==="system"), tool=systems.find(n=>n.label==="Microsoft Teams")!;
  const html=renderToStaticMarkup(createElement(SystemRelationshipMap,{graph,scope:"current",systems,view,onSelect:()=>{},onActivity:()=>{},onWorkflow:()=>{},
    position:{categoryId:"old",systemId:tool.id,page:99,relationPage:99,relationId:"old",relationKind:"transfer"}}));
  assert.doesNotMatch(html,/Microsoft Teamsの仕事・情報を開く|選んだ道具が支える仕事/);
  assert.match(html,/この範囲で使う道具はまだ登録されていません/);
});
