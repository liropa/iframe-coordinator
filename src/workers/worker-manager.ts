// import [* as] SpawnWorker from "../workers/SpawnWorker.worker.ts";
/* Exporting as a class gets by the typescript check and loads the file, however, the constructor
isn't called.  Also, the umd version of the module can't find the default since the worker-loader
seems to export as a constructor function anyway.  So, the raw text version seems to be the best
approach at this point*/
import {
  boolean,
  Guard,
  guard,
  integer,
  object,
  optional,
  string
} from 'decoders';
import { v4 as uuidv4 } from 'uuid';
import { HostToWorkers } from '../messages/HostToWorkers';
import { Publication } from '../messages/Publication';
import {
  validateWorkersToWorkerMgr,
  WorkerLifecycleMsgTypes,
  WorkerMgrToWorkers,
  WorkersToWorkerMgr
} from '../messages/WorkerLifecycle';
import {
  validate as validateWorkerToHostMsg,
  WorkerToHost
} from '../messages/WorkerToHost';
import { WORKER_MESSAGING_PROTOCOL_NAME } from './constants';
import * as SpawnWorker from './spawn-worker.worker.ts';

/**
 * Options to control how workers errors are handled
 */
export interface ErrorWindowConfig {
  /**
   * Duration of the error window.
   * Set to <= 0 to never terminate due to errors.
   * Uses WorkerManager settings if unspecified.
   */
  errorWindowMillis?: number;
  /**
   * Max number of errors which can occur within the error window;
   * Set to -1 to never terminate due to errors and 0 to terminate on the first error.
   * Uses WorkerManager settings if unspecified.
   */
  errorWindowCountThreshold?: number;
}

/**
 * Options to control how workers are torn down
 */
export interface WorkerTerminateConfig {
  /**
   * Notify the spawned worker of impending termination to perform cleanup.
   * Will timeout after terminateReadyWaitMillis.
   * Uses WorkerManager settings if unspecified.
   */
  notifyBeforeTerminate?: boolean;
  /**
   * Millis to allow the worker to prepare for termination.
   * Cannot be set to less than #MIN_WORKERS_TERMINATE_CONFIG (currntely 10 seconds)
   * as the workers need time to do minimal clean-up
   * Uses WorkerManager settings if unspecied
   */
  terminateReadyWaitMillis?: number;
}

/**
 * WorkerClient registration config.
 */
export interface WorkerClientConfig
  extends ErrorWindowConfig,
    WorkerTerminateConfig {
  /** Hosted location of the worker to load */
  url: string;
}

const validateWorkerClientConfig: Guard<WorkerClientConfig> = guard(
  object({
    url: string,
    errorWindowMillis: optional(integer),
    errorWindowCountThreshold: optional(integer),
    notifyBeforeTerminate: optional(boolean),
    terminateReadyWaitMillis: optional(integer)
  })
);

/**
 * A map from worker client identifiers to configuration describing
 * where the worker client app is hosted, options on how it should run, etc.
 */
export interface WorkerMap {
  [key: string]: WorkerClientConfig;
}

/**
 * Handler for messages received from workers which should be handled by the host
 */
export type WorkerToHostMessageHandler = (event: WorkerToHost) => void;

/**
 * Configuration options for the WorkerManager
 */
export interface WorkerManagerConfig
  extends ErrorWindowConfig,
    WorkerTerminateConfig {
  onWorkerToHostMessage?: WorkerToHostMessageHandler;
}

const validateWorkerManagerConfig: Guard<WorkerManagerConfig> = guard(
  object({
    errorWindowMillis: optional(integer),
    errorWindowCountThreshold: optional(integer),
    notifyBeforeTerminate: optional(boolean),
    terminateReadyWaitMillis: optional(integer)
  })
);

const DEFAULT_ERROR_WINDOW_CONFIG: ErrorWindowConfig = {
  errorWindowMillis: 30000,
  errorWindowCountThreshold: 10
};

/**
 * Minimum number of millis that can be set to allow a worker (spawn or spawned)
 * to terminate.
 */
const MIN_WORKERS_TERMINATE_CONFIG = 10000;

const DEFAULT_WORKER_TERMINATE_CONFIG: WorkerTerminateConfig = {
  notifyBeforeTerminate: true,
  terminateReadyWaitMillis: 10000
};

/*
 * TODO for this feature:
 * Revisit/remove worker config to not wait on teardown ready (might always be needed now)
 * Might Need to add clientId support
 * Need to add EnvData init support
 * Clean up file naming and default exports
 * Will docs get pulled in correctly? pull them from client.ts
 * Should we keep protocol?
 *  if so, move from constants
 *  otherwise, remove constants, send, and receive
 * Finalize workerClient api
 * Check on impl interface idea, i.e. ToastingClient,
 * and add NavigationRequester interface
 * and add PubSubClient interface (desi)
 * decide if the onPubsub listener can be passed into the constructor
 * docs
 *   dont forget that this is sorta dangerous with indexeddb
 * unit tests
 *
 * Final Considerations
 * Is the import of the worker good enough?
 * Decide on class or text of the worker
 * Make sure es6 target is ok
 * Make sure it works in IE
 *  check blob and fallback
 *  check on object.assign polyfill
 * Improve worker demo for the real, useful demo.
 *  use subscribe?
 *  allow dynamic addition?
 * Tests
 *  tests for error rate
 *  lifecycle
 * better logging (these are important)
 *
 * Future feature:
 *  allow restart; auto or manual?
 *  worker-requested unload?
 *    will need to support a restart
 */

/** The Lifecycle Phases of Client Workers */
enum WorkerPhase {
  /** The initial spawning web-worker is loading */
  LOADING,
  /** The spawning web-worker has loaded */
  LOADED,
  /** The spawning web-worker is attempting to load the specified worker URL */
  BOOTSTRAPPING,
  /** The spawned web-worker has loaded and is running */
  RUNNING,
  /** The workers (spawning and spawned) are performing clean-up work in preparation for termination */
  UNLOADING
}

/** Internal interface used for tracking ManagedWorker state */
interface ManagedWorker {
  id: string;
  url: string;
  phase: WorkerPhase;
  spawnWorkerToken: string;
  worker: Worker;
  // Error Window config and tracking
  errorWindowConfig: ErrorWindowConfig;
  errorWindowCount: number;
  errorWindowStartTimestamp: number;
  // Terminate config and tracking
  terminateConfig: WorkerTerminateConfig;
  /** true if the spawn worker has loaded and we need to wait on teardown */
  awaitSpawnWorkerUnload: boolean;
  /** boolean indicating if the spawn worker has reported terminate_ready */
  spawnWorkerUnloaded: boolean;
  /** true if the spawned worker has loaded and we need to wait on teardown */
  awaitWorkerUnload: boolean;
  /** boolean indicating if the spawned worker has reported terminate_ready */
  workerUnloaded: boolean;
}

/**
 * Spawns, manages, tracks, and provides a Message bus for web-workers
 * wishing to participate in an iframe-coordinator ecosystem.
 *
 * The worker manager will manage the state of the worker lifecycle as well
 * as track worker health via error listeners.
 */
export default class WorkerManager implements EventListenerObject {
  private static trackedWorkerEventTypes = ['message', 'error'];
  private static ID_PREFIX = 'iframeCoordinatorWorker-';
  private static _workerIndex = 0;
  private _workers: ManagedWorker[];
  private _onWorkerToHostMessage: null | WorkerToHostMessageHandler;
  private _errorWindowConfig: ErrorWindowConfig;
  private _workerTerminateConfig: WorkerTerminateConfig;

  constructor(config: WorkerManagerConfig = {}) {
    if (typeof Worker !== 'function') {
      throw new Error('noWorkerSupport');
    }

    validateWorkerManagerConfig(config);
    // Validate the function here manually
    if (
      // @ts-ignore Ignoring as this is external input and is outside the sanity of typescript
      typeof config.onWorkerToHostMessage !== 'null' &&
      typeof config.onWorkerToHostMessage !== 'function'
    ) {
      throw new Error('onWorkerToHostMessage must be null or a function');
    }

    this._onWorkerToHostMessage = config.onWorkerToHostMessage || null;
    this._errorWindowConfig = buildEffectiveErrorWindowConfig(
      config,
      DEFAULT_ERROR_WINDOW_CONFIG
    );
    this._workerTerminateConfig = buildEffectiveWorkerTerminateConfig(
      config,
      DEFAULT_WORKER_TERMINATE_CONFIG
    );
    this._workerTerminateConfig.terminateReadyWaitMillis = Math.max(
      this._workerTerminateConfig.terminateReadyWaitMillis!,
      MIN_WORKERS_TERMINATE_CONFIG
    );

    this._workers = [];
  }

  /**
   * Load a worker at the specified url
   *
   * @param workerClientConfig Details of workerClient to load
   *
   * @returns An id to reference this worker later
   */
  public load(workerClientConfig: WorkerClientConfig): string {
    validateWorkerClientConfig(workerClientConfig);

    const id = `${WorkerManager.ID_PREFIX}${++WorkerManager._workerIndex}`;

    // @ts-ignore
    const worker = new SpawnWorker();
    WorkerManager.trackedWorkerEventTypes.forEach(curr => {
      worker.addEventListener(curr, this);
    });

    const managedWorker: ManagedWorker = {
      id,
      url: workerClientConfig.url,
      spawnWorkerToken: uuidv4(),
      worker,
      phase: WorkerPhase.LOADING,
      errorWindowConfig: buildEffectiveErrorWindowConfig(
        workerClientConfig,
        this._errorWindowConfig
      ),
      errorWindowCount: 0,
      errorWindowStartTimestamp: -1,
      terminateConfig: buildEffectiveWorkerTerminateConfig(
        workerClientConfig,
        this._workerTerminateConfig
      ),
      awaitSpawnWorkerUnload: false, // false until the spawn worker acks
      spawnWorkerUnloaded: false,
      awaitWorkerUnload: false, // false unless configured and successfully bootstrapped
      workerUnloaded: false
    };

    /*
     * TODO For now, we're hard coding this to true since both workers are listening unconditionally
     * Decide if we need this prop or it should always be true?
     */
    managedWorker.terminateConfig.notifyBeforeTerminate = true;
    managedWorker.terminateConfig.terminateReadyWaitMillis = Math.max(
      managedWorker.terminateConfig.terminateReadyWaitMillis!,
      MIN_WORKERS_TERMINATE_CONFIG
    );

    this._workers.push(managedWorker);

    return id;
  }

  /**
   * Unload the worker with id, idToUnload
   *
   * If configured and applicable, the manager will request a beforeTerminate from both the
   * spawning and spawned workers and wait terminateReadyWaitMillis for a successful terminateReady
   * response.
   *
   * When all cleanup is completed or when the timeout is reached, the worker will be
   * permanently removed.
   *
   * This method can be recalled to re-evaluate reported listener state and quickly terminate
   * the worker rather than wait on the configured timeout.  (e.g. call after each listener reports)
   *
   * @param idToUnload
   */
  public unload(idToUnload: string) {
    const managedWorkerToUnload = this._workers.find((curr, index) => {
      return curr.id === idToUnload;
    });

    if (!managedWorkerToUnload) {
      return;
    }

    const outstandingUnloadListener =
      (managedWorkerToUnload.awaitSpawnWorkerUnload &&
        !managedWorkerToUnload.spawnWorkerUnloaded) ||
      (managedWorkerToUnload.awaitWorkerUnload &&
        !managedWorkerToUnload.workerUnloaded);

    if (!outstandingUnloadListener) {
      this._remove(idToUnload);
      return;
    }

    if (managedWorkerToUnload.phase !== WorkerPhase.UNLOADING) {
      managedWorkerToUnload.phase = WorkerPhase.UNLOADING;

      this._dispatchMessageToWorker(managedWorkerToUnload.worker, {
        msgType: WorkerLifecycleMsgTypes.BeforeTerminate,
        msg: null
      });

      // Set a timeout to force unload if we don't hear back.
      setTimeout(() => {
        this._remove(idToUnload, true);
      }, managedWorkerToUnload.terminateConfig.terminateReadyWaitMillis);
    }
  }

  /**
   * Pubish provided publication to all currently running workers.
   *
   * @param publication The Publication instance to send to the workers
   */
  public publish(publication: Publication): void {
    this._workers
      .filter(curr => curr.phase === WorkerPhase.RUNNING)
      .forEach(curr => {
        this._dispatchMessageToWorker(curr.worker, {
          msgType: 'publish',
          msg: publication
        });
      });
  }

  private _remove(idToRemove: string, timedOut: boolean = false) {
    const workerIndexToRemove = this._workers.findIndex((curr, index) => {
      return curr.id === idToRemove;
    });

    if (workerIndexToRemove >= 0) {
      const managedWorkerToRemove = this._workers[workerIndexToRemove];
      WorkerManager.trackedWorkerEventTypes.forEach(curr => {
        managedWorkerToRemove.worker.removeEventListener(curr, this);
      });
      managedWorkerToRemove.worker.terminate();

      this._workers.splice(workerIndexToRemove, 1);

      if (timedOut) {
        // TODO Need to add proper logging support
        // tslint:disable-next-line
        console.warn('Worker force-stopped due to unload timeout', {
          workerDetails: managedWorkerToRemove
        });
      }
    }
  }

  /**
   * Implements the EventListener interface so this class can handle inbound messages
   * and error events from the pool of managed workers.
   *
   * @param evt The triggered event from a managed worker.
   */
  public handleEvent(evt: Event): void {
    const targetManagedWorker = this._workers.find(curr => {
      return curr.worker === evt.target;
    });

    if (!targetManagedWorker) {
      // TODO Need to add proper logging support
      // tslint:disable-next-line
      console.error('Received message from unknown worker');
      return;
    }

    if (evt instanceof MessageEvent) {
      const msgEvent = evt as MessageEvent;

      if (msgEvent.data.protocol !== WORKER_MESSAGING_PROTOCOL_NAME) {
        // Not a handled message type
        return;
      }

      const workerToHost = validateWorkerToHostMsg(msgEvent.data);
      if (workerToHost !== null) {
        if (
          this._onWorkerToHostMessage !== null &&
          targetManagedWorker.phase !== WorkerPhase.UNLOADING
        ) {
          this._onWorkerToHostMessage(workerToHost);
        }

        return;
      }

      const workerMsg = validateWorkersToWorkerMgr(msgEvent.data);
      if (workerMsg !== null) {
        this._handleWorkerLifecycleEvent(workerMsg, targetManagedWorker);

        return;
      }

      // TODO Need to add proper logging support
      // tslint:disable-next-line
      console.error(
        'Worker Message could not be parsed to a known, valid type',
        {
          workerId: targetManagedWorker.id,
          workerUrl: targetManagedWorker.url,
          eventPayload: msgEvent.data
        }
      );
    } else if (evt instanceof ErrorEvent) {
      this._handleWorkerErrorEvent(evt, targetManagedWorker);
    }
  }

  /**
   * Handle inbound lifecycle events from workers
   *
   * @param workerMsg The valid, inbound event sent from either the spawnWorker or worker
   * @param targetManagedWorker The ManagedWorker instance monitoring the worker who sent the event
   * @returns boolean to ensure all cases from the descriminated union are handled
   */
  private _handleWorkerLifecycleEvent(
    workerMsg: WorkersToWorkerMgr,
    targetManagedWorker: ManagedWorker
  ): boolean {
    switch (workerMsg.msgType) {
      case WorkerLifecycleMsgTypes.SpawnWorkerLoaded:
        if (targetManagedWorker.phase !== WorkerPhase.LOADING) {
          this._logBadTransition(
            targetManagedWorker,
            WorkerLifecycleMsgTypes.SpawnWorkerLoaded
          );

          return false;
        }

        targetManagedWorker.phase = WorkerPhase.LOADED;
        targetManagedWorker.awaitSpawnWorkerUnload = true;

        targetManagedWorker.phase = WorkerPhase.BOOTSTRAPPING;
        this._dispatchMessageToWorker(targetManagedWorker.worker, {
          msgType: WorkerLifecycleMsgTypes.Bootstrap,
          msg: {
            workerUrl: targetManagedWorker.url,
            spawnWorkerToken: targetManagedWorker.spawnWorkerToken
          }
        });

        return true;
      case WorkerLifecycleMsgTypes.Bootstrapped:
        if (
          targetManagedWorker.spawnWorkerToken !==
          workerMsg.msg.spawnWorkerToken
        ) {
          // TODO Need to add proper logging support
          // tslint:disable-next-line
          console.error('Missing spawnWorkerToken in SpawnWorker Msg', {
            workerId: targetManagedWorker.id,
            workerUrl: targetManagedWorker.url
          });

          return false;
        }

        if (targetManagedWorker.phase !== WorkerPhase.BOOTSTRAPPING) {
          this._logBadTransition(
            targetManagedWorker,
            WorkerLifecycleMsgTypes.Bootstrapped
          );

          return false;
        }

        targetManagedWorker.phase = WorkerPhase.RUNNING;
        targetManagedWorker.awaitWorkerUnload = targetManagedWorker.terminateConfig.notifyBeforeTerminate!;

        return true;
      case WorkerLifecycleMsgTypes.BootstrapFailed:
        if (
          targetManagedWorker.spawnWorkerToken !==
          workerMsg.msg.spawnWorkerToken
        ) {
          // TODO Need to add proper logging support
          // tslint:disable-next-line
          console.error('Missing spawnWorkerToken in SpawnWorker Msg', {
            workerId: targetManagedWorker.id,
            workerUrl: targetManagedWorker.url
          });

          return false;
        }

        if (targetManagedWorker.phase !== WorkerPhase.BOOTSTRAPPING) {
          this._logBadTransition(
            targetManagedWorker,
            WorkerLifecycleMsgTypes.BootstrapFailed
          );

          return false;
        }

        // TODO Need to add proper logging support
        // tslint:disable-next-line
        console.error('Failed to bootstrap the worker.  Stopping the worker', {
          workerId: targetManagedWorker.id,
          workerUrl: targetManagedWorker.url,
          failureReason: workerMsg.msg.failureReason
        });

        this.unload(targetManagedWorker.id);

        return true;
      case WorkerLifecycleMsgTypes.SpawnWorkerTerminateReady:
        if (
          targetManagedWorker.spawnWorkerToken !==
          workerMsg.msg.spawnWorkerToken
        ) {
          // TODO Need to add proper logging support
          // tslint:disable-next-line
          console.error('Missing spawnWorkerToken in SpawnWorker Msg', {
            workerId: targetManagedWorker.id,
            workerUrl: targetManagedWorker.url
          });

          return false;
        }

        if (targetManagedWorker.phase !== WorkerPhase.UNLOADING) {
          this._logBadTransition(
            targetManagedWorker,
            WorkerLifecycleMsgTypes.SpawnWorkerTerminateReady
          );

          return false;
        }

        targetManagedWorker.spawnWorkerUnloaded = true;
        this.unload(targetManagedWorker.id);
        return true;
      case WorkerLifecycleMsgTypes.WorkerTerminateReady:
        if (targetManagedWorker.phase !== WorkerPhase.UNLOADING) {
          this._logBadTransition(
            targetManagedWorker,
            WorkerLifecycleMsgTypes.WorkerTerminateReady
          );

          return false;
        }

        targetManagedWorker.workerUnloaded = true;
        this.unload(targetManagedWorker.id);
        return true;
    }
  }

  /**
   * Logs the attempted bad transition
   */
  private _logBadTransition(
    managedWorker: ManagedWorker,
    msgType: WorkerLifecycleMsgTypes
  ) {
    // TODO Need to add proper logging support
    // tslint:disable-next-line
    console.error('Worker attempted bad lifecycle phase transition', {
      currPhase: managedWorker.phase,
      msgType,
      workerId: managedWorker.id,
      workerUrl: managedWorker.url
    });
  }

  private _handleWorkerErrorEvent(
    evt: ErrorEvent,
    targetManagedWorker: ManagedWorker
  ) {
    if (
      targetManagedWorker.errorWindowConfig.errorWindowMillis! <= 0 ||
      targetManagedWorker.errorWindowConfig.errorWindowCountThreshold! < 0
    ) {
      // Error rate tracking disabled for worker
      return;
    }

    if (targetManagedWorker.phase === WorkerPhase.UNLOADING) {
      // Don't process errors for workers already unloading
      return;
    }

    const currentTimestamp = Date.now();

    if (targetManagedWorker.errorWindowStartTimestamp < 0) {
      // First Error
      targetManagedWorker.errorWindowStartTimestamp = currentTimestamp;
      targetManagedWorker.errorWindowCount = 1;

      if (
        targetManagedWorker.errorWindowConfig.errorWindowCountThreshold === 0
      ) {
        // TODO Need to add proper logging support
        // tslint:disable-next-line
        console.error(
          'Error encountered on zero error tolorance worker config.  Stopping the worker',
          {
            workerDetails: targetManagedWorker,
            errorDetails: evt.error
          }
        );

        this.unload(targetManagedWorker.id);
      }

      return;
    }

    const delta = Math.max(
      currentTimestamp - targetManagedWorker.errorWindowStartTimestamp,
      0
    );
    if (delta > targetManagedWorker.errorWindowConfig.errorWindowMillis!) {
      // Window expired; start new window
      targetManagedWorker.errorWindowStartTimestamp = currentTimestamp;
      targetManagedWorker.errorWindowCount = 1;
      return;
    } else {
      targetManagedWorker.errorWindowCount++;

      if (
        targetManagedWorker.errorWindowCount >
        targetManagedWorker.errorWindowConfig.errorWindowCountThreshold!
      ) {
        // TODO Need to add proper logging support
        // tslint:disable-next-line
        console.error('Error rate exceeded.  Stopping the worker', {
          workerDetails: targetManagedWorker,
          errorWindowCount: targetManagedWorker.errorWindowCount,
          errorWindowStartTimestamp:
            targetManagedWorker.errorWindowStartTimestamp,
          errorWindowDurationMillis: delta,
          errorDetails: evt.error
        });

        this.unload(targetManagedWorker.id);
      }
    }
  }

  private _dispatchMessageToWorker(
    worker: Worker,
    msg: WorkerMgrToWorkers | HostToWorkers
  ): void {
    worker.postMessage(
      Object.assign(
        {
          protocol: WORKER_MESSAGING_PROTOCOL_NAME
        },
        msg
      )
    );
  }
}

/**
 * Helper function to merge optional values with defaults
 */
function buildEffectiveErrorWindowConfig(
  options: ErrorWindowConfig,
  defaults: ErrorWindowConfig
): ErrorWindowConfig {
  return {
    errorWindowMillis:
      typeof options.errorWindowMillis !== 'undefined'
        ? options.errorWindowMillis
        : defaults.errorWindowMillis,
    errorWindowCountThreshold:
      typeof options.errorWindowCountThreshold !== 'undefined'
        ? options.errorWindowCountThreshold
        : defaults.errorWindowCountThreshold
  };
}

/**
 * Helper function to merge optional values with defaults
 */
function buildEffectiveWorkerTerminateConfig(
  options: WorkerTerminateConfig,
  defaults: WorkerTerminateConfig
): WorkerTerminateConfig {
  return {
    notifyBeforeTerminate:
      typeof options.notifyBeforeTerminate !== 'undefined'
        ? options.notifyBeforeTerminate
        : defaults.notifyBeforeTerminate,
    terminateReadyWaitMillis:
      typeof options.terminateReadyWaitMillis !== 'undefined'
        ? options.terminateReadyWaitMillis
        : defaults.terminateReadyWaitMillis
  };
}
