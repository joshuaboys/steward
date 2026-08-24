import { durableObjectName } from "../identity.ts";
import type { StewardEvent } from "../types.ts";

export function locateSteward(event: StewardEvent): string {
  return durableObjectName(event.subject);
}
