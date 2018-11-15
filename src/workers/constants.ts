export const WORKER_MESSAGING_PROTOCOL_NAME: string =
  'iframe-coordinator/workers';

// TODO Rename to WorkerToManager?
/** Exhaustive list of messages types from Worker to Host */
export enum WorkerToHostMessageTypes {
  /** Request a Nav operation */
  navRequest = 'navRequest',
  /** Request a Toast */
  toastRequest = 'toastRequest'
}

/** Exhaustive list of event types used in managing a worker's lifecycle */
export enum WorkerLifecycleEvents {
  /** Spawing worker has loaded */
  loaded = 'loaded',
  /** Spawing worker is bootsrapping the worker */
  bootstrap = 'bootstrap',
  /** Spawned worker failed to load/start */
  bootstrap_failed = 'bootstrap_failed',
  /** Spawned worker has loaded/started */
  bootstrapped = 'bootstrapped',
  // TODO rename to before_terminate, terminate_ready?
  /** Worker should clean-up before termination */
  before_unload = 'before_unload',
  /** Worker is ready for termination */
  unload_ready = 'unload_ready'
}

/** Used to discriminate the types of events sent/received between worker and manager */
export enum WorkerClientEventType {
  /** A Lifecycle Event triggered by either the ManagedWorker or the WorkerManager */
  LIFECYCLE,
  /** An Action Event triggered by a ManagedWorker */
  HOST_ACTION
}

/** Union type of all Event interfaces sent/received between worker and manager */
export type WorkerClientEvent =
  | WorkerClientLifecycleEvent
  | WorkerClientHostActionEvent;

/** Contains fields common to all events sent/received between worker and manager */
export interface WorkerClientBaseEvent {
  kind: WorkerClientEventType;
  targetWorker: Worker;
  msg: any; // TODO Need better fidelity
}

/** Definition of Lifecycle events sent/received between worker and manager */
export interface WorkerClientLifecycleEvent extends WorkerClientBaseEvent {
  kind: WorkerClientEventType.LIFECYCLE;
  lifecycleEventType: WorkerLifecycleEvents;
  fromSpawnWorker: boolean;
}

// TODO Rename with direction in mind?
/** Definition of Action events sent from the worker to the manager */
export interface WorkerClientHostActionEvent extends WorkerClientBaseEvent {
  kind: WorkerClientEventType.HOST_ACTION;
  actionType: WorkerToHostMessageTypes;
}
