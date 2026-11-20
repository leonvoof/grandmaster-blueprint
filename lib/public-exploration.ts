import type { ExplorationTree } from "./position-exploration.ts";

export function rememberPath(tree: ExplorationTree, id: string, preferred: Record<string, string>) {
  let node = tree.nodes[id];
  while (node.parentId) {
    preferred[node.parentId] = node.id;
    node = tree.nodes[node.parentId];
  }
}

export function publicExplorationTarget(tree: ExplorationTree, key: string, preferred: Record<string, string>) {
  const next = (id: string) => {
    const children = tree.nodes[id].children;
    return children.includes(preferred[id]) ? preferred[id] : children[0];
  };
  if (key === "ArrowUp") return tree.rootId;
  if (key === "ArrowLeft") return tree.nodes[tree.currentId].parentId;
  if (key === "ArrowRight") return next(tree.currentId) ?? null;
  if (key !== "ArrowDown") return null;
  let end = tree.currentId;
  for (let child = next(end); child; child = next(end)) end = child;
  return end;
}

export type SavedBranch = { parent: string; from: string; to: string; promotion: "q" | "r" | "b" | "n" | null };

export function variationEdges(tree: ExplorationTree): SavedBranch[] {
  return Object.values(tree.nodes).filter((node) => node.source === "exploration").map((node) => ({
    parent: node.parentId!, from: node.from!, to: node.to!, promotion: node.promotion as SavedBranch["promotion"],
  }));
}

export function validateVariationEdges(input: unknown): SavedBranch[] {
  if (!Array.isArray(input) || input.length > 600) throw new Error("Invalid variation tree backup.");
  return input.map(({ parent, from, to, promotion }) => {
    if (typeof parent !== "string" || !/^(0|[1-9]\d{0,3})$/.test(parent)
      || typeof from !== "string" || !/^[a-h][1-8]$/.test(from)
      || typeof to !== "string" || !/^[a-h][1-8]$/.test(to)
      || (promotion !== null && !["q", "r", "b", "n"].includes(promotion))) throw new Error("Invalid variation move.");
    return { parent, from, to, promotion };
  });
}
