import {
  SpawnWorkerToWorkerMgr,
  validateWorkerMgrToSpawnWorker,
  WorkerLifecycleMsgTypes
} from '../messages/WorkerLifecycle';
import { WORKER_MESSAGING_PROTOCOL_NAME } from './constants';

const ctx: Worker = self as any;
let spawnWorkerToken: null | string = null;

ctx.addEventListener('message', handleHostMessage);

/**
 * Handles spawn-relavent inbound messages from the WorkerManager
 */
function handleHostMessage(msgEvt: MessageEvent): boolean {
  if (
    !msgEvt ||
    !msgEvt.data ||
    msgEvt.data.protocol !== WORKER_MESSAGING_PROTOCOL_NAME
  ) {
    return false;
  }

  const lifecycleMsg = validateWorkerMgrToSpawnWorker(msgEvt.data);

  if (lifecycleMsg === null) {
    // No logging needed here; Other messages may be handled by the worker itself
    return false;
  }

  switch (lifecycleMsg.msgType) {
    case WorkerLifecycleMsgTypes.Bootstrap:
      try {
        spawnWorkerToken = lifecycleMsg.msg.spawnWorkerToken;
        importScripts(lifecycleMsg.msg.workerUrl);
        _sendLifecycleMsgToMgr({
          msgType: WorkerLifecycleMsgTypes.Bootstrapped,
          msg: {
            spawnWorkerToken: spawnWorkerToken!
          }
        });
      } catch (error) {
        _sendLifecycleMsgToMgr({
          msgType: WorkerLifecycleMsgTypes.BootstrapFailed,
          msg: {
            spawnWorkerToken: spawnWorkerToken!,
            failureReason: error ? error.toString() : null
          }
        });
      }

      return true;
    case WorkerLifecycleMsgTypes.BeforeTerminate:
      ctx.removeEventListener('message', handleHostMessage);
      _sendLifecycleMsgToMgr({
        msgType: WorkerLifecycleMsgTypes.SpawnWorkerTerminateReady,
        msg: {
          spawnWorkerToken: spawnWorkerToken!
        }
      });

      return true;
  }
}

// Notify the WorkerManager that the spawn worker has loaded successfully
_sendLifecycleMsgToMgr({
  msgType: WorkerLifecycleMsgTypes.SpawnWorkerLoaded,
  msg: null
});

/**
 * Dispatch the provided lifecycle message to the WorkerManager
 *
 * @private
 */
function _sendLifecycleMsgToMgr(lifecycleMsg: SpawnWorkerToWorkerMgr) {
  ctx.postMessage(
    Object.assign(
      {
        protocol: WORKER_MESSAGING_PROTOCOL_NAME
      },
      lifecycleMsg
    )
  );
}

export default null as any;
