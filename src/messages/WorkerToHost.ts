import { LabeledNavRequest, validateNavRequest } from './NavRequest';
import { LabeledPublication, validatePublication } from './Publication';
import { LabeledToast, validateToast } from './Toast';

/**
 * All action messages that could be sent from the spawned worker to the worker manager.
 */
export type WorkerToHost =
  | LabeledToast
  | LabeledNavRequest
  | LabeledPublication;

/**
 * Validates correctness of messages being sent from
 * a worker to the host.
 * @param msg The message requiring validation.
 */
export function validate(msg: any): WorkerToHost | null {
  if (!msg || !msg.msgType || !msg.msg) {
    return null;
  }

  return (
    validateNavRequest(msg) || validateToast(msg) || validatePublication(msg)
  );
}
