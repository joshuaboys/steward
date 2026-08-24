import type {
  Approval,
  Belief,
  CapabilityCall,
  Decision,
  EventDisposition,
  Fact,
  Intent,
  LogEntry,
  RunRecord,
  StewardEvent,
  StewardIdentity,
  StewardSchedule,
  WaitSubscription,
  Watcher,
} from "../types.ts";

export interface StewardRepositories {
  getIdentity(): StewardIdentity | undefined;
  putIdentity(identity: StewardIdentity): void;
  listIntents(): Intent[];
  putIntent(intent: Intent): void;
  insertEvent(event: StewardEvent): boolean;
  getEvent(id: string): StewardEvent | undefined;
  listEvents(): StewardEvent[];
  setEventDisposition(id: string, disposition: EventDisposition, runId?: string): void;
  getEventDisposition(id: string): { disposition?: EventDisposition; runId?: string } | undefined;
  putRun(run: RunRecord): void;
  getRun(id: string): RunRecord | undefined;
  listRuns(): RunRecord[];
  putFact(fact: Fact): void;
  listFacts(): Fact[];
  getFact(key: string): Fact | undefined;
  putBelief(belief: Belief): void;
  listBeliefs(): Belief[];
  putDecision(decision: Decision): void;
  listDecisions(): Decision[];
  putCapabilityCall(call: CapabilityCall): void;
  listCapabilityCalls(): CapabilityCall[];
  putApproval(approval: Approval): void;
  getApproval(id: string): Approval | undefined;
  listApprovals(): Approval[];
  putWatcher(watcher: Watcher): void;
  listWatchers(): Watcher[];
  putWait(wait: WaitSubscription): void;
  listWaits(): WaitSubscription[];
  putSchedule(schedule: StewardSchedule): void;
  listSchedules(): StewardSchedule[];
  appendLog(entry: LogEntry): void;
  listLogs(): LogEntry[];
  snapshot(): StewardSnapshot;
  restore(snapshot: StewardSnapshot): void;
  reset(): void;
}

export interface StewardSnapshot {
  identity?: StewardIdentity;
  intents: Intent[];
  events: Array<StewardEvent & { disposition?: EventDisposition; runId?: string }>;
  runs: RunRecord[];
  facts: Fact[];
  beliefs: Belief[];
  decisions: Decision[];
  capabilityCalls: CapabilityCall[];
  approvals: Approval[];
  watchers: Watcher[];
  waits: WaitSubscription[];
  schedules: StewardSchedule[];
  logs: LogEntry[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryStore implements StewardRepositories {
  private identity?: StewardIdentity;
  private intents = new Map<string, Intent>();
  private events = new Map<
    string,
    StewardEvent & { disposition?: EventDisposition; runId?: string }
  >();
  private runs = new Map<string, RunRecord>();
  private facts = new Map<string, Fact>();
  private beliefs = new Map<string, Belief>();
  private decisions = new Map<string, Decision>();
  private capabilityCalls = new Map<string, CapabilityCall>();
  private approvals = new Map<string, Approval>();
  private watchers = new Map<string, Watcher>();
  private waits = new Map<string, WaitSubscription>();
  private schedules = new Map<string, StewardSchedule>();
  private logs: LogEntry[] = [];

  getIdentity() {
    return this.identity ? clone(this.identity) : undefined;
  }

  putIdentity(identity: StewardIdentity) {
    this.identity = clone(identity);
  }

  listIntents() {
    return [...this.intents.values()].map(clone);
  }

  putIntent(intent: Intent) {
    this.intents.set(intent.id, clone(intent));
  }

  insertEvent(event: StewardEvent): boolean {
    if (this.events.has(event.id)) return false;
    this.events.set(event.id, clone(event));
    return true;
  }

  getEvent(id: string) {
    const row = this.events.get(id);
    return row ? clone(row) : undefined;
  }

  listEvents() {
    return [...this.events.values()]
      .map(clone)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  }

  setEventDisposition(id: string, disposition: EventDisposition, runId?: string) {
    const row = this.events.get(id);
    if (!row) return;
    row.disposition = disposition;
    if (runId) row.runId = runId;
  }

  getEventDisposition(id: string) {
    const row = this.events.get(id);
    if (!row) return undefined;
    return { disposition: row.disposition, runId: row.runId };
  }

  putRun(run: RunRecord) {
    this.runs.set(run.id, clone(run));
  }

  getRun(id: string) {
    const row = this.runs.get(id);
    return row ? clone(row) : undefined;
  }

  listRuns() {
    return [...this.runs.values()].map(clone).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  putFact(fact: Fact) {
    this.facts.set(fact.key, clone(fact));
  }

  listFacts() {
    return [...this.facts.values()].map(clone);
  }

  getFact(key: string) {
    const row = this.facts.get(key);
    return row ? clone(row) : undefined;
  }

  putBelief(belief: Belief) {
    this.beliefs.set(belief.key, clone(belief));
  }

  listBeliefs() {
    return [...this.beliefs.values()].map(clone);
  }

  putDecision(decision: Decision) {
    this.decisions.set(decision.id, clone(decision));
  }

  listDecisions() {
    return [...this.decisions.values()].map(clone);
  }

  putCapabilityCall(call: CapabilityCall) {
    this.capabilityCalls.set(call.id, clone(call));
  }

  listCapabilityCalls() {
    return [...this.capabilityCalls.values()].map(clone);
  }

  putApproval(approval: Approval) {
    this.approvals.set(approval.id, clone(approval));
  }

  getApproval(id: string) {
    const row = this.approvals.get(id);
    return row ? clone(row) : undefined;
  }

  listApprovals() {
    return [...this.approvals.values()].map(clone);
  }

  putWatcher(watcher: Watcher) {
    this.watchers.set(watcher.id, clone(watcher));
  }

  listWatchers() {
    return [...this.watchers.values()].map(clone);
  }

  putWait(wait: WaitSubscription) {
    this.waits.set(wait.id, clone(wait));
  }

  listWaits() {
    return [...this.waits.values()].map(clone);
  }

  putSchedule(schedule: StewardSchedule) {
    this.schedules.set(schedule.id, clone(schedule));
  }

  listSchedules() {
    return [...this.schedules.values()].map(clone);
  }

  appendLog(entry: LogEntry) {
    this.logs.push(clone(entry));
    if (this.logs.length > 400) this.logs.splice(0, this.logs.length - 400);
  }

  listLogs() {
    return this.logs.map(clone);
  }

  snapshot(): StewardSnapshot {
    return {
      identity: this.getIdentity(),
      intents: this.listIntents(),
      events: this.listEvents(),
      runs: this.listRuns(),
      facts: this.listFacts(),
      beliefs: this.listBeliefs(),
      decisions: this.listDecisions(),
      capabilityCalls: this.listCapabilityCalls(),
      approvals: this.listApprovals(),
      watchers: this.listWatchers(),
      waits: this.listWaits(),
      schedules: this.listSchedules(),
      logs: this.listLogs(),
    };
  }

  restore(snapshot: StewardSnapshot) {
    this.reset();
    if (snapshot.identity) this.putIdentity(snapshot.identity);
    snapshot.intents.forEach((row) => this.putIntent(row));
    for (const event of snapshot.events) {
      this.insertEvent(event);
      if (event.disposition) this.setEventDisposition(event.id, event.disposition, event.runId);
    }
    snapshot.runs.forEach((row) => this.putRun(row));
    snapshot.facts.forEach((row) => this.putFact(row));
    snapshot.beliefs.forEach((row) => this.putBelief(row));
    snapshot.decisions.forEach((row) => this.putDecision(row));
    snapshot.capabilityCalls.forEach((row) => this.putCapabilityCall(row));
    snapshot.approvals.forEach((row) => this.putApproval(row));
    snapshot.watchers.forEach((row) => this.putWatcher(row));
    snapshot.waits.forEach((row) => this.putWait(row));
    snapshot.schedules.forEach((row) => this.putSchedule(row));
    snapshot.logs.forEach((row) => this.appendLog(row));
  }

  reset() {
    this.identity = undefined;
    this.intents.clear();
    this.events.clear();
    this.runs.clear();
    this.facts.clear();
    this.beliefs.clear();
    this.decisions.clear();
    this.capabilityCalls.clear();
    this.approvals.clear();
    this.watchers.clear();
    this.waits.clear();
    this.schedules.clear();
    this.logs = [];
  }
}
