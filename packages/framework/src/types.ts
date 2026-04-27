export type Lifecycle = "ACTIVE" | "DEPRECATED" | "ARCHIVED" | "PURGE";

export interface Entity {
  id: string;
  lifecycle: Lifecycle;
  tenantId: string;
}
