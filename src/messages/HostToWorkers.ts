import { LabeledPublication, validatePublication } from './Publication';

/**
 * All action messages that could be sent from the host to the workers.
 */
export type HostToWorkers = LabeledPublication;

/**
 * Validates correctness of messages being sent from
 * the host to a workers.
 * @param msg The message requiring validation.
 */
export function validate(msg: any): HostToWorkers | null {
  if (!msg || !msg.msgType || !msg.msg) {
    return null;
  }

  return validatePublication(msg);
}
