import type { LensGraph } from "@/lib/graph";
export function ProcessContextEditor({
  graph,
  stepId,
  onApply,
}: {
  graph: LensGraph;
  stepId: string;
  onApply: (graph: LensGraph) => void;
}) {
  const step = graph.nodes.find((n) => n.id === stepId && n.kind === "process");
  if (!step) return null;
  return (
    <details className="flow-note" open>
      <summary>「{step.label}」の判断を補足・修正する</summary>
      {(["trigger", "rule", "exception"] as const).map((key, i) => (
        <label className="kg-edit-field" key={key}>
          {["始まるきっかけ", "判断・ルール", "失敗・例外への対応"][i]}
          <textarea
            value={step.executionContext?.[key] ?? ""}
            onChange={(e) =>
              onApply({
                ...graph,
                nodes: graph.nodes.map((n) =>
                  n.id === stepId
                    ? {
                        ...n,
                        executionContext: {
                          trigger: "",
                          rule: "",
                          exception: "",
                          ...n.executionContext,
                          [key]: e.target.value,
                        },
                      }
                    : n,
                ),
              })
            }
          />
        </label>
      ))}
    </details>
  );
}
