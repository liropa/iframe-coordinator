// import [* as] SpawnWorker from "../workers/SpawnWorker.worker.ts";
/* Exporting as a class gets by the typescript check and loads the file, however, the constructor
isn't called.  Also, the umd version of the module can't find the default since the worker-loader
seems to export as a constructor function anyway.  So, the raw text version seems to be the best
approach at this point*/
import { v4 as uuidv4 } from 'uuid';
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
 * A map from background client identifiers to configuration describing
 * where the background client app is hosted, options on how it should run, etc.
 */
export interface BackgroundMap {
  [key: string]: BackgroundClientRegistration;
}

/**
 * BackgroundClient registration config. The 'url' parameter is the location where
 * the background client application is hosted.
 */
interface BackgroundClientRegistration {
  url: string;
  // TODO add config options here like error rates, etc.
}

const DEFAULT_ERROR_WINDOW_COUNT_THRESHOLD = 10;
const DEFAULT_ERROR_WINDOW_MILLIS = 30000;
const DEFAULT_UNLOAD_TIMEOUT_MILLIS = 10000;

/*
 * TODO for this feature:

 * Rename BAckgroundClient
 * Clean up file naming
 * Decide on toastingClient api
 * Should we keep protocol?
 *  if so, move from constants
 *  otherwise, remove constants, send, and receive
 * move registration of background clients into class?  auto-load?
 * Need to revisit naming:
  * worker vs backgroundClient (dev has to know its a worker)
  * worker and workerManger
  * workerMgr vs host
  * spawnWorker vs loadingWorker vs bootstrappingWorker
 * add config option so spawned workers can request shutdown
 * Move config to be per-worker
 *  make a type/class
 *  add cleanup boolean here
 *  pass into constructor for defaults and load function
 *  class also has an instance for default defaults
 *  type ManagedWorkerConfig = {
 *    url: string;
 *    // Optional?
 *    errorWindowCountThreshold: number;
 *    errorWindowMillis: number;
 *    requestUnloadNotification:boolean;
 *    unloadTimeoutMillis: number;
 *  }
 * get bi-directional comms working
 *  need to add an interface for the background client
 *  need to add listener for events
 * Finalize backgroundClient api
   * Check on impl interface idea and add NavigationRequester interface
   * should navRequest be url based?
   * Will docs get pulled in correctly? pull them from client.ts
 * docs
 *   dont forget that this is sorta dangerous with indexeddb
 *
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

/** The Lifecycle Phases of Background Client Workers */
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
  errorWindowCount: number;
  errorWindowStartTimestamp: number;
  awaitSpawnWorkerUnload: boolean;
  spawnWorkerUnloaded: boolean;
  spawnedWorkerUnloadRequested: boolean;
  awaitSpawnedWorkerUnload: boolean;
  spawnedWorkerUnloaded: boolean;
}

/**
 * Handler for messages received from workers which should be handled by the host
 */
type WorkerToHostMessageHandler = (event: WorkerToHost) => void;

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
  private _errorWindowCountThreshold: number;
  private _errorWindowMillis: number;
  private _unloadTimeoutMillis: number;
  private _onWorkerToHostMessage: null | WorkerToHostMessageHandler;

  constructor(
    onWorkerToHostMessage: null | WorkerToHostMessageHandler = null,
    errorWindowCountThreshold: number = DEFAULT_ERROR_WINDOW_COUNT_THRESHOLD,
    errorWindowMillis: number = DEFAULT_ERROR_WINDOW_MILLIS,
    unloadTimeoutMillis: number = DEFAULT_UNLOAD_TIMEOUT_MILLIS
  ) {
    if (typeof Worker !== 'function') {
      throw new Error('noWorkerSupport');
    }

    this._onWorkerToHostMessage = onWorkerToHostMessage;

    this._errorWindowCountThreshold = errorWindowCountThreshold;
    this._errorWindowMillis = errorWindowMillis;
    this._unloadTimeoutMillis = unloadTimeoutMillis;

    this._workers = [];
  }

  /**
   * Load a worker at the specified url
   *
   * @param url The URL of the worker to load
   *
   * @returns An id to reference this worker later
   */
  public load(url: string): string {
    const id = `${WorkerManager.ID_PREFIX}${++WorkerManager._workerIndex}`;

    // @ts-ignore
    const worker = new SpawnWorker();
    WorkerManager.trackedWorkerEventTypes.forEach(curr => {
      worker.addEventListener(curr, this);
    });

    this._workers.push({
      id,
      url,
      spawnWorkerToken: uuidv4(),
      worker,
      phase: WorkerPhase.LOADING,
      errorWindowCount: 0,
      errorWindowStartTimestamp: -1,
      awaitSpawnWorkerUnload: false, // false until the spawn worker acks
      spawnWorkerUnloaded: false,
      spawnedWorkerUnloadRequested: false,
      awaitSpawnedWorkerUnload: false, // false unless configured and successfully bootstrapped
      spawnedWorkerUnloaded: false
    });

    return id;
  }

  /**
   * Unload the worker with id, idToUnload
   *
   * If configured and applicable, the manager will request a before_unload from both the
   * spawning and spawned workers and wait #_unloadTimeoutMillis for a successful unload_ready response.
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
      (managedWorkerToUnload.awaitSpawnedWorkerUnload &&
        !managedWorkerToUnload.spawnedWorkerUnloaded);

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
      }, this._unloadTimeoutMillis);
    }
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

  // TODO Need comms to workers (pub/sub, others?)

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
        targetManagedWorker.awaitSpawnedWorkerUnload =
          targetManagedWorker.spawnedWorkerUnloadRequested;

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

        targetManagedWorker.spawnedWorkerUnloaded = true;
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
    const currentTimestamp = Date.now();

    if (targetManagedWorker.errorWindowStartTimestamp < 0) {
      // First Error
      targetManagedWorker.errorWindowStartTimestamp = currentTimestamp;
      targetManagedWorker.errorWindowCount = 1;
      return;
    }

    const delta = Math.max(
      currentTimestamp - targetManagedWorker.errorWindowStartTimestamp,
      0
    );
    if (delta > this._errorWindowMillis) {
      // Window expired; start new window
      targetManagedWorker.errorWindowStartTimestamp = currentTimestamp;
      targetManagedWorker.errorWindowCount = 1;
      return;
    } else {
      targetManagedWorker.errorWindowCount++;

      if (
        targetManagedWorker.errorWindowCount > this._errorWindowCountThreshold
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
    msg: WorkerMgrToWorkers
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
