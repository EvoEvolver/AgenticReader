export interface TreeNode {
  title: string;
  content: string;
  children: TreeNode[];
  summary?: string;
}

export interface NodeMetadata {
  level: number;
  tagName: string;
  order: number;
}
