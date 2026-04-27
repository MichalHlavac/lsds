// Abstract TraversalEngine — concrete implementations in apps/api (A10)
export interface TraversalEngine {
  traverse(rootId: string, depth: number): Promise<string[]>;
}
