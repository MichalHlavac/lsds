import type { Lifecycle } from "./lifecycle";

export interface Entity {
  id: string;
  lifecycle: Lifecycle;
  tenantId: string;
}
