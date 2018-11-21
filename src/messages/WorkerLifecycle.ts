import {
  boolean,
  guard,
  maybe,
  mixed,
  null_,
  object,
  optional,
  string
} from 'decoders';
import { LabeledMsg } from './LabeledMsg';
import { createMessageValidator } from './validationUtils';

/** Exhaustive list of message types used in managing a worker's lifecycle */
export enum WorkerLifecycleMsgTypes {
  /** Spawn worker has loaded */
  SpawnWorkerLoaded = 'spawnWorkerLoaded',
  /** Spawn worker should bootstrap ... including spawing the worker */
  Bootstrap = 'bootstrap',
  /** Spawn worker bootstrap process failed */
  BootstrapFailed = 'bootstrapFailed',
  /** Spawned worker bootstrapped successfully */
  Bootstrapped = 'bootstrapped',
  /** Spawn and Spawned worker should clean-up before termination */
  BeforeTerminate = 'beforeTerminate',
  /** Spawn Worker is ready for termination */
  SpawnWorkerTerminateReady = 'spawnWorkerTerminateReady',
  /** Spawned Worker is ready for termination */
  WorkerTerminateReady = 'workerTerminateReady'
}

/**
 * Base payload of messages originating from the Spawn worker used to identify
 * it as such.
 */
export interface SpawnWorkerBasePayload {
  spawnWorkerToken: string;
}
const spawnWorkerBasePayloadMapping = {
  spawnWorkerToken: string
};
const spawnWorkerBasePayloadGuard = guard(
  object(spawnWorkerBasePayloadMapping)
);

/**
 * A message used to notify the manager that the spawning worker has loaded
 */
export interface SpawnWorkerLoadedMsg extends LabeledMsg {
  msgType: WorkerLifecycleMsgTypes.SpawnWorkerLoaded;
  msg: null;
}

/**
 * Validates correctness of SpawnWorkerLoaded lifecycle message
 *
 * @param msg The message requiring validation.
 * @returns The message object if valid; null otherwise.
 */
export const validateSpawnWorkerLoadedMsg = createMessageValidator<
  SpawnWorkerLoadedMsg
>(WorkerLifecycleMsgTypes.SpawnWorkerLoaded, null_);

/**
 * Payload of a Bootstrap Message
 */
interface BootstrapPayload extends SpawnWorkerBasePayload {
  workerUrl: string;
}

/**
 * A message used to notify the spawn worker that it should bootstrap
 */
export interface BootstrapMsg extends LabeledMsg {
  msgType: WorkerLifecycleMsgTypes.Bootstrap;
  msg: BootstrapPayload;
}

/**
 * Validates correctness of Bootstrap lifecycle message
 *
 * @param msg The message requiring validation.
 * @returns The message object if valid; null otherwise.
 */
export const validateBootstrapMsg = createMessageValidator<BootstrapMsg>(
  WorkerLifecycleMsgTypes.Bootstrap,
  guard(
    object(
      Object.assign(
        {
          workerUrl: string
        },
        spawnWorkerBasePayloadMapping
      )
    )
  )
);

/**
 * A message used to notify the manager that the spawn worker has successfully bootstrapped
 */
export interface BootstrappedMsg extends LabeledMsg {
  msgType: WorkerLifecycleMsgTypes.Bootstrapped;
  msg: SpawnWorkerBasePayload;
}

/**
 * Validates correctness of Bootstrapped lifecycle message
 *
 * @param msg The message requiring validation.
 * @returns The message object if valid; null otherwise.
 */
export const validateBootstrappedMsg = createMessageValidator<BootstrappedMsg>(
  WorkerLifecycleMsgTypes.Bootstrapped,
  spawnWorkerBasePayloadGuard
);

/**
 * Payload of a BootstrapFailed Message
 */
interface BootstrapFailedPayload extends SpawnWorkerBasePayload {
  failureReason?: string;
}

/**
 * A message used to notify the manager that the spawn worker bootstrapping failed
 */
export interface BootstrapFailedMsg extends LabeledMsg {
  msgType: WorkerLifecycleMsgTypes.BootstrapFailed;
  msg: BootstrapFailedPayload;
}

/**
 * Validates correctness of BootstrapFailed lifecycle message
 *
 * @param msg The message requiring validation.
 * @returns The message object if valid; null otherwise.
 */
export const validateBootstrapFailedMsg = createMessageValidator<
  BootstrapFailedMsg
>(
  WorkerLifecycleMsgTypes.BootstrapFailed,
  guard(
    object(
      Object.assign(
        {
          failureReason: maybe(string)
        },
        spawnWorkerBasePayloadMapping
      )
    )
  )
);

/**
 * A message used to notify the workers (Spawn and Spawned) that they should clean up for termination
 */
export interface BeforeTerminateMsg extends LabeledMsg {
  msgType: WorkerLifecycleMsgTypes.BeforeTerminate;
  msg: null;
}

/**
 * Validates correctness of BeforeTerminate lifecycle message
 *
 * @param msg The message requiring validation.
 * @returns The message object if valid; null otherwise.
 */
export const validateBeforeTerminateMsg = createMessageValidator<
  BeforeTerminateMsg
>(WorkerLifecycleMsgTypes.BeforeTerminate, null_);

/**
 * A message used to notify the manager that the spawn worker cleanup is complete
 */
export interface SpawnWorkerTerminateReadyMsg extends LabeledMsg {
  msgType: WorkerLifecycleMsgTypes.SpawnWorkerTerminateReady;
  msg: SpawnWorkerBasePayload;
}

/**
 * Validates correctness of SpawnWorkerTerminateReady lifecycle message
 *
 * @param msg The message requiring validation.
 * @returns The message object if valid; null otherwise.
 */
export const validateSpawnWorkerTerminateReadyMsg = createMessageValidator<
  SpawnWorkerTerminateReadyMsg
>(
  WorkerLifecycleMsgTypes.SpawnWorkerTerminateReady,
  spawnWorkerBasePayloadGuard
);

/**
 * A message used to notify the manager that the spawned worker cleanup is complete
 */
export interface WorkerTerminateReadyMsg extends LabeledMsg {
  msgType: WorkerLifecycleMsgTypes.WorkerTerminateReady;
  msg: null;
}

/**
 * Validates correctness of WorkerTerminateReady lifecycle message
 *
 * @param msg The message requiring validation.
 * @returns The message object if valid; null otherwise.
 */
export const validateWorkerTerminateReadyMsg = createMessageValidator<
  WorkerTerminateReadyMsg
>(WorkerLifecycleMsgTypes.WorkerTerminateReady, null_);

/**
 * All lifecycle messages that could be sent from the worker manger
 * to the spawn worker.
 */
export type WorkerMgrToSpawnWorker = BootstrapMsg | BeforeTerminateMsg;

/**
 * Validates correctness of lifecycle messages being sent from
 * the worker manager to the spawn worker.
 * @param msg The message requiring validation.
 */
export function validateWorkerMgrToSpawnWorker(
  msg: any
): WorkerMgrToSpawnWorker | null {
  if (!msg || !msg.msgType) {
    return null;
  }

  return validateBootstrapMsg(msg) || validateBeforeTerminateMsg(msg);
}

/**
 * All lifecycle messages that could be sent from the worker maanger
 * to the spawned worker.
 */
export type WorkerMgrToWorker = BeforeTerminateMsg;

/**
 * Validates correctness of lifecycle messages being sent from
 * the worker manager to the spawned worker.
 * @param msg The message requiring validation.
 */
export function validateWorkerMgrToWorker(msg: any): WorkerMgrToWorker | null {
  if (!msg || !msg.msgType) {
    return null;
  }

  return validateBeforeTerminateMsg(msg);
}

/**
 * All lifecycle messages that could be sent from the worker maanger
 * to both the spawn and spawned workers.
 */
export type WorkerMgrToWorkers = WorkerMgrToSpawnWorker | WorkerMgrToWorker;

/**
 * All lifecycle messages that could be sent from the spawn worker
 * to the worker manager.
 */
export type SpawnWorkerToWorkerMgr =
  | SpawnWorkerLoadedMsg
  | BootstrappedMsg
  | BootstrapFailedMsg
  | SpawnWorkerTerminateReadyMsg;

/**
 * Validates correctness of lifecycle messages being sent from
 * the spawn worker to the worker manager.
 * @param msg The message requiring validation.
 */
export function validateSpawnWorkerToWorkerMgr(
  msg: any
): SpawnWorkerToWorkerMgr | null {
  if (!msg || !msg.msgType) {
    return null;
  }

  return (
    validateSpawnWorkerLoadedMsg(msg) ||
    validateBootstrappedMsg(msg) ||
    validateBootstrapFailedMsg(msg) ||
    validateSpawnWorkerTerminateReadyMsg(msg)
  );
}

/**
 * All lifecycle messages that could be sent from the spawned worker
 * to the worker manager.
 */
export type WorkerToWorkerMgr = WorkerTerminateReadyMsg;

/**
 * Validates correctness of lifecycle messages being sent from
 * the spawned worker to the worker manager.
 * @param msg The message requiring validation.
 */
export function validateWorkerToWorkerMgr(msg: any): WorkerToWorkerMgr | null {
  if (!msg || !msg.msgType) {
    return null;
  }

  return validateWorkerTerminateReadyMsg(msg);
}

/**
 * All lifecycle messages that could be sent from the both the spawn and spawned worker
 * to the worker manager.
 */
export type WorkersToWorkerMgr = SpawnWorkerToWorkerMgr | WorkerToWorkerMgr;

/**
 * Validates correctness of lifecycle messages being sent from
 * both the spawn and spawned workers to the worker manager.
 * @param msg The message requiring validation.
 */
export function validateWorkersToWorkerMgr(
  msg: any
): WorkersToWorkerMgr | null {
  if (!msg || !msg.msgType) {
    return null;
  }

  return validateSpawnWorkerToWorkerMgr(msg) || validateWorkerToWorkerMgr(msg);
}
